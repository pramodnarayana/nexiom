import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SYNC_INTERVAL_OPTIONS } from '@nexiom/database';
import type {
  integrationStitches,
  SyncIntervalMinutes,
} from '@nexiom/database';
import { WindmillClient } from './windmill.client.js';
import { intervalToCron } from './interval-to-cron.js';
import { SyncRunner } from './sync-runner.js';

type Stitch = typeof integrationStitches.$inferSelect;

/** Validates that a raw DB value is a recognised sync interval. */
function isSyncIntervalMinutes(value: unknown): value is SyncIntervalMinutes {
  return (SYNC_INTERVAL_OPTIONS as readonly unknown[]).includes(value);
}

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly windmill: WindmillClient,
    private readonly syncRunner: SyncRunner,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.windmill.ensureStitchScript();
    } catch (err) {
      // Log and continue — a bootstrap failure must not crash the application.
      // The script will be re-created on the next successful startup.
      this.logger.error(
        `Failed to ensure stitch-runner script on startup: ${String(err)}. Scheduling may not work until resolved.`,
      );
    }
  }

  /**
   * Called after a stitch is created.
   * Creates a Windmill schedule only when scheduleEnabled=true and
   * syncIntervalMinutes is set.
   */
  async onStitchCreated(stitch: Stitch): Promise<void> {
    if (!stitch.scheduleEnabled) {
      return;
    }
    const cron = this.toCron(stitch);
    if (!cron) return;
    await this.windmill.createSchedule(stitch.id, cron, true);
    this.logger.log(`Schedule created for stitch ${stitch.id} (${cron})`);
  }

  /**
   * Called after a stitch is updated.
   * Syncs the Windmill schedule state to match the stitch's current settings.
   * Uses update-first to avoid a TOCTOU race between scheduleExists and create/update.
   */
  async onStitchUpdated(stitch: Stitch): Promise<void> {
    const { id, scheduleEnabled: enabled } = stitch;
    const cron = this.toCron(stitch);
    if (!cron) return;

    const wasUpdated = await this.windmill.updateSchedule(id, cron, enabled);
    if (wasUpdated) {
      this.logger.log(
        `Updated schedule for stitch ${id} (${cron}, enabled=${enabled})`,
      );
    } else {
      await this.windmill.createSchedule(id, cron, enabled);
      this.logger.log(
        `Created schedule for stitch ${id} during update (${cron}, enabled=${enabled})`,
      );
    }
  }

  /**
   * Called after a stitch is archived/removed.
   * Deletes its Windmill schedule if one exists.
   */
  async onStitchDeleted(stitchId: string): Promise<void> {
    await this.windmill.deleteSchedule(stitchId);
    this.logger.log(`Deleted schedule for stitch ${stitchId}`);
  }

  /**
   * Deletes all Windmill schedules for a set of stitch IDs (e.g. org deletion).
   * Failures are logged individually but do not abort the remaining deletions.
   */
  async deleteOrgSchedules(stitchIds: string[]): Promise<void> {
    const results = await Promise.allSettled(
      stitchIds.map((id) => this.windmill.deleteSchedule(id)),
    );
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Failed to delete schedule for stitch ${stitchIds[i]}: ${String(result.reason)}`,
        );
      }
    });
  }

  /**
   * Triggers an immediate one-off run of the given stitch.
   * Returns the Windmill job ID.
   */
  async triggerOnce(stitchId: string): Promise<string> {
    const jobId = await this.windmill.triggerOnce(stitchId);
    this.logger.log(
      `Triggered one-off job for stitch ${stitchId}: jobId=${jobId}`,
    );
    return jobId;
  }

  /**
   * Entry point called by the internal scheduler controller when Windmill
   * invokes /internal/scheduler/execute-stitch.
   */
  async executeStitch(
    stitchId: string,
  ): Promise<{ stitchId: string; status: string }> {
    this.logger.log(`Executing stitch ${stitchId}`);
    try {
      const result = await this.syncRunner.run(stitchId);
      this.logger.log(
        `Stitch ${stitchId} execution completed: status=${result.status}`,
      );
      return result;
    } catch (err) {
      this.logger.error(`Stitch ${stitchId} execution failed: ${String(err)}`);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Converts a stitch's syncIntervalMinutes to a cron expression.
   * Returns null and logs an error if the value is invalid so callers can
   * skip schedule operations cleanly rather than throwing mid-flight.
   */
  private toCron(stitch: Stitch): string | null {
    if (!isSyncIntervalMinutes(stitch.syncIntervalMinutes)) {
      this.logger.error(
        `Stitch ${stitch.id} has an unrecognised syncIntervalMinutes value: ` +
          `${String(stitch.syncIntervalMinutes)}. Skipping schedule operation.`,
      );
      return null;
    }
    return intervalToCron(stitch.syncIntervalMinutes);
  }
}
