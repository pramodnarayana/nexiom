import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq, sql } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  schedulerOutbox,
  integrationStitches,
} from '@nexiom/database';
import { SchedulerService } from './scheduler.service.js';

// 1 initial attempt + 5 retries = 6 total attempts.
// Back-off delays between attempts: 2s, 4s, 8s, 16s, 32s.
const MAX_OUTBOX_ATTEMPTS = 6;
const BATCH_SIZE = 20;

/**
 * OutboxWorkerService
 *
 * Polls the scheduler_outbox table every 10 seconds and delivers pending
 * Windmill schedule operations with at-least-once semantics.
 *
 * Claiming strategy: UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)
 * ensures multiple pods never double-process the same record.
 *
 * Retry strategy: exponential back-off (2^attempt seconds) up to
 * MAX_OUTBOX_ATTEMPTS, after which the record is marked 'failed' for
 * human/alerting review.
 */
@Injectable()
export class OutboxWorkerService {
  private readonly logger = new Logger(OutboxWorkerService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly scheduler: SchedulerService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async processOutbox(): Promise<void> {
    // Atomically claim pending records using FOR UPDATE SKIP LOCKED so
    // concurrent pods cannot pick up the same record.
    const claimed = await this.db.transaction(async (tx) => {
      return tx
        .update(schedulerOutbox)
        .set({
          status: 'processing',
          attempts: sql`${schedulerOutbox.attempts} + 1`,
        })
        .where(
          sql`${schedulerOutbox.id} IN (
            SELECT id FROM scheduler_outbox
            WHERE status = 'pending' AND next_retry_at <= NOW()
            ORDER BY next_retry_at ASC
            LIMIT ${BATCH_SIZE}
            FOR UPDATE SKIP LOCKED
          )`,
        )
        .returning();
    });

    if (claimed.length === 0) return;

    this.logger.debug(
      `Claimed ${claimed.length} outbox record(s) for processing (ids=${claimed.map((r) => r.id).join(',')})`,
    );

    await Promise.allSettled(
      claimed.map((record) => this.processRecord(record)),
    );
  }

  private async processRecord(
    record: typeof schedulerOutbox.$inferSelect,
  ): Promise<void> {
    try {
      if (record.action === 'deleted') {
        await this.scheduler.onStitchDeleted(record.stitchId);
      } else {
        // Re-read stitch to get current state before calling Windmill.
        const stitch = await this.db.query.integrationStitches.findFirst({
          where: eq(integrationStitches.id, record.stitchId),
        });

        if (!stitch || stitch.status === 'ARCHIVED') {
          // Stitch is gone or archived — the separate 'deleted' outbox record
          // (inserted by remove()) will clean up the Windmill schedule.
          this.logger.debug(
            `Outbox record ${record.id}: stitch ${record.stitchId} is absent/archived — skipping ${record.action}`,
          );
          await this.markSucceeded(record.id);
          return;
        }

        if (record.action === 'created') {
          await this.scheduler.onStitchCreated(stitch);
        } else {
          await this.scheduler.onStitchUpdated(stitch);
        }
      }

      await this.markSucceeded(record.id);
      this.logger.debug(
        `Outbox record succeeded: id=${record.id} action=${record.action} stitchId=${record.stitchId} attempts=${record.attempts}`,
      );
    } catch (err) {
      await this.handleFailure(record, err);
    }
  }

  private async markSucceeded(id: string): Promise<void> {
    await this.db
      .update(schedulerOutbox)
      .set({ status: 'succeeded', processedAt: new Date() })
      .where(eq(schedulerOutbox.id, id));
  }

  private async handleFailure(
    record: typeof schedulerOutbox.$inferSelect,
    err: unknown,
  ): Promise<void> {
    const lastError = err instanceof Error ? err.message : String(err);

    if (record.attempts >= MAX_OUTBOX_ATTEMPTS) {
      // Permanently failed — mark for alerting/human review.
      await this.db
        .update(schedulerOutbox)
        .set({ status: 'failed', lastError, processedAt: new Date() })
        .where(eq(schedulerOutbox.id, record.id));
      this.logger.error(
        `Outbox record permanently failed: id=${record.id} action=${record.action} ` +
          `stitchId=${record.stitchId} attempts=${record.attempts}/${MAX_OUTBOX_ATTEMPTS} ` +
          `error="${lastError}"`,
      );
    } else {
      // Exponential back-off between attempts: 2s, 4s, 8s, 16s, 32s.
      const delayMs = Math.pow(2, record.attempts) * 1_000;
      const nextRetryAt = new Date(Date.now() + delayMs);
      await this.db
        .update(schedulerOutbox)
        .set({ status: 'pending', lastError, nextRetryAt })
        .where(eq(schedulerOutbox.id, record.id));
      this.logger.warn(
        `Outbox record will retry: id=${record.id} action=${record.action} ` +
          `stitchId=${record.stitchId} attempt=${record.attempts}/${MAX_OUTBOX_ATTEMPTS} ` +
          `nextRetryAt=${nextRetryAt.toISOString()} error="${lastError}"`,
      );
    }
  }
}
