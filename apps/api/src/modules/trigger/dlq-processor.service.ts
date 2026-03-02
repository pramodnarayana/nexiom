import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  TriggerExecutorService,
  type TriggerRunParams,
} from './trigger-executor.service';
import { PieceRegistryService } from './piece-registry.service';

const MAX_ATTEMPTS = 3;

/**
 * Redis key namespace:
 *  dlq:triggers           — ready queue (RPOPLPUSH source)
 *  dlq:triggers:processing — atomic in-flight list
 *  dlq:triggers:delayed   — sorted set of deferred retries (score = epoch ms)
 *  dlq:triggers:failed    — permanently exhausted jobs
 */
const DLQ_KEY = 'dlq:triggers';
const DLQ_PROCESSING_KEY = 'dlq:triggers:processing';
const DLQ_DELAYED_KEY = 'dlq:triggers:delayed';
const DLQ_FAILED_KEY = 'dlq:triggers:failed';

interface DlqJob {
  appName: string;
  triggerName: string;
  workspaceId: string;
  objectType?: string;
  propsValue: Record<string, unknown>;
  auth: unknown;
  failedAt: string;
  error: string;
  attempt: number;
  /** Optional: earliest epoch ms when this job may be retried */
  nextAttemptAt?: number;
}

/**
 * Dead-Letter Queue processor.
 *
 * Every minute:
 *  1. Promotes delayed jobs whose nextAttemptAt has passed back to DLQ_KEY.
 *  2. Atomically moves jobs from DLQ_KEY → DLQ_PROCESSING_KEY (RPOPLPUSH) —
 *     no job is lost if the process dies mid-flight.
 *  3. Retries each job via TriggerExecutorService.runPoll().
 *     - runPoll returns false when a poll lock is held → job is re-queued
 *       rather than silently dropped.
 *     - On success the job is removed from DLQ_PROCESSING_KEY.
 *     - On failure the job is incremented and either re-queued into the
 *       delayed sorted set (with exponential back-off) or moved to failed.
 *
 * Security:
 *  - Raw DLQ payloads are never logged; only a SHA-256 prefix is emitted so
 *    credential fields cannot appear in log sinks.
 */
@Injectable()
export class DlqProcessorService {
  private readonly logger = new Logger(DlqProcessorService.name);
  private readonly BATCH_SIZE = 50;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly executor: TriggerExecutorService,
    private readonly pieceRegistry: PieceRegistryService,
  ) {}

  // ─── Cron: promote delayed jobs ──────────────────────────────────────────

  @Cron(CronExpression.EVERY_MINUTE)
  async processDlq(): Promise<void> {
    await this.promoteDelayedJobs();
    await this.drainReadyJobs();
  }

  /**
   * Atomically removes delayed jobs whose score ≤ now from the sorted set
   * and re-queues them into the ready DLQ.
   *
   * ZPOPMIN is atomic (remove + return in one command), avoiding the
   * ZRANGEBYSCORE → ZREM race where two instances could both read the
   * same members before either had removed them.
   *
   * We pop up to BATCH_SIZE items and discard any whose score is in the
   * future (shouldn't happen, but guards against clock drift).
   */
  private async promoteDelayedJobs(): Promise<void> {
    const now = Date.now();

    // [member, score, member, score, ...] alternating
    const popped = await this.redis.zpopmin(DLQ_DELAYED_KEY, this.BATCH_SIZE);
    if (popped.length === 0) return;

    // Pair up [member, score] tuples and filter by due time
    const due: string[] = [];
    const future: Array<[string, number]> = [];
    for (let i = 0; i < popped.length; i += 2) {
      const member = popped[i];
      const score = Number(popped[i + 1]);
      if (score <= now) {
        due.push(member);
      } else {
        future.push([member, score]); // popped too early — re-add
      }
    }

    // Re-add any items whose score is in the future (clock skew guard)
    if (future.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const [member, score] of future) {
        pipeline.zadd(DLQ_DELAYED_KEY, score, member);
      }
      await pipeline.exec();
    }

    if (due.length === 0) return;

    // Batch-push all due items into the ready queue
    const pipeline = this.redis.pipeline();
    for (const raw of due) {
      pipeline.lpush(DLQ_KEY, raw);
    }
    await pipeline.exec();
    this.logger.debug(
      `Promoted ${due.length} delayed DLQ job(s) to ready queue`,
    );
  }

  // ─── Drain ready queue ───────────────────────────────────────────────────

  private async drainReadyJobs(): Promise<void> {
    for (let i = 0; i < this.BATCH_SIZE; i++) {
      // Atomic move: pop from DLQ_KEY, push to processing list
      // If the process dies between pop and ack, the job remains in processing.
      const raw = await this.redis.rpoplpush(DLQ_KEY, DLQ_PROCESSING_KEY);
      if (!raw) break;

      await this.handleJob(raw);
    }
  }

  // ─── Single-job handler ──────────────────────────────────────────────────

  private async handleJob(raw: string): Promise<void> {
    // Parse — log only a hash prefix, never the raw payload (may contain auth).
    let job: DlqJob;
    try {
      job = JSON.parse(raw) as DlqJob;
    } catch (error_) {
      const fingerprint = createHash('sha256')
        .update(raw)
        .digest('hex')
        .slice(0, 12);
      this.logger.error('DLQ job could not be parsed — discarding', {
        fingerprint,
        length: raw.length,
        parseError: error_ instanceof Error ? error_.message : String(error_),
      });
      await this.redis.lrem(DLQ_PROCESSING_KEY, 1, raw);
      return;
    }

    const trigger = this.pieceRegistry.getTrigger(job.appName, job.triggerName);
    if (!trigger) {
      this.logger.warn('DLQ job references unknown trigger — discarding', {
        appName: job.appName,
        triggerName: job.triggerName,
      });
      await this.redis.lrem(DLQ_PROCESSING_KEY, 1, raw);
      return;
    }

    const params: TriggerRunParams = {
      trigger,
      appName: job.appName,
      triggerName: job.triggerName,
      objectType: job.objectType,
      auth: job.auth,
      propsValue: job.propsValue,
      workspaceId: job.workspaceId,
    };

    try {
      const executed = await this.executor.runPoll(params);

      if (!executed) {
        // Lock contention — requeue immediately (no increment) so it's retried
        // on the next cron tick once the lock is released.
        this.logger.debug('DLQ job skipped (lock contention) — requeueing', {
          appName: job.appName,
          triggerName: job.triggerName,
        });
        await this.redis.lrem(DLQ_PROCESSING_KEY, 1, raw);
        await this.redis.lpush(DLQ_KEY, raw);
        return;
      }

      // Success — remove from in-flight list
      await this.redis.lrem(DLQ_PROCESSING_KEY, 1, raw);
      this.logger.log('DLQ job retried successfully', {
        appName: job.appName,
        triggerName: job.triggerName,
        attempt: job.attempt,
      });
    } catch (err) {
      const nextAttempt = job.attempt + 1;

      if (nextAttempt >= MAX_ATTEMPTS) {
        // Permanently failed — move to human-inspection list
        const failedPayload = JSON.stringify({
          appName: job.appName,
          triggerName: job.triggerName,
          workspaceId: job.workspaceId,
          attempt: nextAttempt,
          exhaustedAt: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        });
        await this.redis.lrem(DLQ_PROCESSING_KEY, 1, raw);
        await this.redis.lpush(DLQ_FAILED_KEY, failedPayload);
        this.logger.error('DLQ job exhausted retries — moved to failed list', {
          appName: job.appName,
          triggerName: job.triggerName,
        });
      } else {
        // Schedule a delayed retry via sorted set (score = epoch ms)
        const delay = Math.pow(2, nextAttempt) * 1000;
        const retryJob = JSON.stringify({
          appName: job.appName,
          triggerName: job.triggerName,
          workspaceId: job.workspaceId,
          objectType: job.objectType,
          propsValue: job.propsValue,
          auth: job.auth,
          failedAt: job.failedAt,
          error: err instanceof Error ? err.message : String(err),
          attempt: nextAttempt,
          nextAttemptAt: Date.now() + delay,
        });
        await this.redis.lrem(DLQ_PROCESSING_KEY, 1, raw);
        await this.redis.zadd(DLQ_DELAYED_KEY, Date.now() + delay, retryJob);
        this.logger.warn(
          `DLQ job failed (attempt ${nextAttempt}/${MAX_ATTEMPTS}) — scheduled delay ${delay}ms`,
          { appName: job.appName, triggerName: job.triggerName },
        );
      }
    }
  }
}
