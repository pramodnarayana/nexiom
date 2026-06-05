import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import {
  TriggerExecutorService,
  type TriggerRunParams,
} from './trigger-executor.service.js';
import { PieceRegistryService } from '@soopa/piece-registry';
import { ITriggerDlqService } from './interfaces/trigger-dlq.interface.js';

const MAX_ATTEMPTS = 3;

interface DlqJob {
  appName: string;
  triggerName: string;
  workspaceId: string;
  tenantId: string;
  dataSourceId: string;
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
    @Inject(ITriggerDlqService) private readonly dlqService: ITriggerDlqService,
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

  private async promoteDelayedJobs(): Promise<void> {
    const promoted = await this.dlqService.promoteDelayedJobs(this.BATCH_SIZE);
    if (promoted > 0) {
      this.logger.debug(
        `Promoted ${promoted} delayed DLQ job(s) to ready queue`,
      );
    }
  }

  private readonly STALE_LEASE_MS = 10 * 60 * 1000; // 10 minutes

  private async reclaimStaleProcessingJobs(): Promise<void> {
    const reclaimed = await this.dlqService.reclaimStaleJobs(
      this.STALE_LEASE_MS,
      this.BATCH_SIZE,
    );
    if (reclaimed > 0) {
      this.logger.warn(`Reclaimed ${reclaimed} stale in-flight DLQ job(s)`);
    }
  }

  // ─── Drain ready queue ───────────────────────────────────────────────────

  private async drainReadyJobs(): Promise<void> {
    await this.dlqService.drainReadyJobs(this.BATCH_SIZE, async (raw) => {
      await this.handleJob(raw);
    });
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
      await this.dlqService.removeUnparseableJob(raw);
      return;
    }

    const trigger = this.pieceRegistry.getTrigger(job.appName, job.triggerName);
    if (!trigger) {
      this.logger.warn('DLQ job references unknown trigger — discarding', {
        appName: job.appName,
        triggerName: job.triggerName,
      });
      await this.dlqService.acknowledgeJob(raw); // discard it
      return;
    }

    const params: TriggerRunParams = {
      trigger,
      appName: job.appName,
      triggerName: job.triggerName,
      objectType: job.objectType,
      auth: job.auth,
      propsValue: job.propsValue,
      tenantId: job.tenantId,
      workspaceId: job.workspaceId,
      dataSourceId: job.dataSourceId,
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
        await this.dlqService.scheduleDelayedRetry(raw, retryPayload, delay);
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
      await this.dlqService.acknowledgeJob(raw);
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
        tenantId: job.tenantId,
        workspaceId: job.workspaceId,
        dataSourceId: job.dataSourceId,
        attempt: nextAttempt,
        exhaustedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
      await this.dlqService.markJobFailed(raw, failedPayload);
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
        tenantId: job.tenantId,
        workspaceId: job.workspaceId,
        dataSourceId: job.dataSourceId,
        objectType: job.objectType,
        propsValue: job.propsValue,
        auth: job.auth,
        payload: job.payload,
        failedAt: job.failedAt,
        error: err instanceof Error ? err.message : String(err),
        attempt: nextAttempt,
        nextAttemptAt: Date.now() + delay,
      });
      await this.dlqService.scheduleDelayedRetry(raw, retryJob, delay);
      this.logger.warn(
        `DLQ job failed (attempt ${nextAttempt}/${MAX_ATTEMPTS}) — scheduled delay ${delay}ms`,
        { appName: job.appName, triggerName: job.triggerName },
      );
    }
  }
}
