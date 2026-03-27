import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  TriggerExecutorService,
  type WebhookRunParams,
  type TriggerRunParams,
} from './trigger-executor.service.js';
import { PieceRegistryService } from '@nexiom/engine';

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
  payload?: unknown;
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
    await this.reclaimStaleProcessingJobs();
    await this.drainReadyJobs();
  }

  /**
   * Fully atomic delayed-job promotion via a single Lua script.
   *
   * The Lua script:
   *   1. ZRANGEBYSCORE — read due members (score ≤ now).
   *   2. For each member, LPUSH into DLQ_KEY (ready queue).
   *   3. ZREM those members from DLQ_DELAYED_KEY.
   *
   * All three steps happen inside one Redis atomic execution, so there is
   * no window where a process crash can leave items removed from the sorted
   * set but not yet in the ready queue.
   */
  private async promoteDelayedJobs(): Promise<void> {
    const now = Date.now();

    const LUA_PROMOTE = [
      'local members = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", ARGV[1], "LIMIT", 0, ARGV[2])',
      'if #members > 0 then',
      '  for _, m in ipairs(members) do',
      '    redis.call("LPUSH", KEYS[2], m)',
      '    redis.call("ZREM", KEYS[1], m)',
      '  end',
      'end',
      'return #members',
    ].join('\n');

    const promoted = (await this.redis.eval(
      LUA_PROMOTE,
      2, // numkeys
      DLQ_DELAYED_KEY, // KEYS[1]
      DLQ_KEY, // KEYS[2]
      String(now), // ARGV[1] — upper score bound
      String(this.BATCH_SIZE), // ARGV[2] — page limit
    )) as number;

    if (promoted > 0) {
      this.logger.debug(
        `Promoted ${promoted} delayed DLQ job(s) to ready queue`,
      );
    }
  }

  /**
   * Reclaims stale in-flight jobs from DLQ_PROCESSING_KEY.
   *
   * Jobs are moved via RPOPLPUSH so a crashed pod leaves them in
   * DLQ_PROCESSING_KEY indefinitely.  Each job payload stores a
   * `processingStartedAt` timestamp; any item older than STALE_LEASE_MS is
   * considered abandoned and moved back to DLQ_KEY for retry.
   *
   * Atomicity: a Lua script reads the list tail, checks the timestamp, and
   * if stale performs RPOPLPUSH(processing → ready) in one atomic step.
   */
  private readonly STALE_LEASE_MS = 10 * 60 * 1000; // 10 minutes

  private async reclaimStaleProcessingJobs(): Promise<void> {
    const staleThreshold = Date.now() - this.STALE_LEASE_MS;

    // Lua: inspect the tail of the processing list, move back if stale
    const LUA_RECLAIM = [
      'local item = redis.call("LINDEX", KEYS[1], -1)',
      'if not item then return 0 end',
      'local ok, parsed = pcall(cjson.decode, item)',
      'if not ok then',
      '  -- Unparseable item: remove exactly this tail item rather than searching',
      '  redis.call("RPOP", KEYS[1])',
      '  return 0',
      'end',
      'if not parsed.processingStartedAt or parsed.processingStartedAt > tonumber(ARGV[1]) then',
      '  return 0',
      'end',
      'redis.call("RPOPLPUSH", KEYS[1], KEYS[2])',
      'return 1',
    ].join('\n');

    let reclaimed = 0;
    // Iterate up to BATCH_SIZE times (one item per eval call for atomicity)
    for (let i = 0; i < this.BATCH_SIZE; i++) {
      const moved = (await this.redis.eval(
        LUA_RECLAIM,
        2,
        DLQ_PROCESSING_KEY,
        DLQ_KEY,
        String(staleThreshold),
      )) as number;
      if (!moved) break;
      reclaimed++;
    }

    if (reclaimed > 0) {
      this.logger.warn(`Reclaimed ${reclaimed} stale in-flight DLQ job(s)`);
    }
  }

  // ─── Drain ready queue ───────────────────────────────────────────────────

  private async drainReadyJobs(): Promise<void> {
    // Atomically move from DLQ_KEY to DLQ_PROCESSING_KEY and stamp processingStartedAt
    // so the reclaim script can detect stale leases if the pod crashes.
    const LUA_DRAIN = [
      'local item = redis.call("RPOP", KEYS[1])',
      'if not item then return nil end',
      'local ok, parsed = pcall(cjson.decode, item)',
      'if ok then',
      '  parsed.processingStartedAt = tonumber(ARGV[1])',
      '  item = cjson.encode(parsed)',
      'end',
      'redis.call("LPUSH", KEYS[2], item)',
      'return item',
    ].join('\n');

    for (let i = 0; i < this.BATCH_SIZE; i++) {
      const raw = (await this.redis.eval(
        LUA_DRAIN,
        2,
        DLQ_KEY,
        DLQ_PROCESSING_KEY,
        String(Date.now()),
      )) as string | null;
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

    const params: TriggerRunParams | WebhookRunParams = {
      trigger,
      appName: job.appName,
      triggerName: job.triggerName,
      objectType: job.objectType,
      auth: job.auth,
      propsValue: job.propsValue,
      workspaceId: job.workspaceId,
      ...(job.payload !== undefined && { payload: job.payload }),
    };

    try {
      const executed = await this.executor.runPoll(
        params,
        /* fromDlqRetry */ true,
      );

      if (!executed) {
        // Lock contention — defer via delayed sorted-set (MIN_RETRY_DELAY_MS)
        // so drainReadyJobs cannot pick this up again in the same cron pass.
        const delay = 5_000; // 5 s back-off before the next cron tick
        const retryPayload = JSON.stringify({
          ...job,
          nextAttemptAt: Date.now() + delay,
        });
        await this.redis.lrem(DLQ_PROCESSING_KEY, 1, raw);
        await this.redis.zadd(
          DLQ_DELAYED_KEY,
          Date.now() + delay,
          retryPayload,
        );
        this.logger.debug(
          'DLQ job deferred (lock contention) — scheduled in delayed set',
          {
            appName: job.appName,
            triggerName: job.triggerName,
            delayMs: delay,
          },
        );
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
      await this.handleJobFailure(job, raw, err);
    }
  }

  private async handleJobFailure(
    job: DlqJob,
    raw: string,
    err: unknown,
  ): Promise<void> {
    const nextAttempt = job.attempt + 1;

    if (nextAttempt > MAX_ATTEMPTS) {
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
        payload: job.payload,
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
