import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SYNC_INTERVAL_OPTIONS } from '@nexiom/database';
import type { dataSources, SyncIntervalMinutes } from '@nexiom/database';
import { WindmillClient } from './windmill.client.js';
import { intervalToCron } from './interval-to-cron.js';
import { SyncRunner } from './sync-runner.js';

type DataSource = typeof dataSources.$inferSelect;

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
      await this.windmill.ensureConnectionScript();
    } catch (err) {
      // Log and continue — a bootstrap failure must not crash the application.
      // The script will be re-created on the next successful startup.
      this.logger.error(
        `Failed to ensure connection-runner script on startup: ${String(err)}. Scheduling may not work until resolved.`,
      );
    }
  }

  /**
   * Called after a connection is created.
   * Creates a Windmill schedule only when scheduleEnabled=true and
   * syncIntervalMinutes is set.
   */
  async onConnectionCreated(connection: DataSource): Promise<void> {
    if (!connection.scheduleEnabled) {
      return;
    }
    const cron = this.toCron(connection);
    if (!cron) {
      this.logger.warn(
        `Cannot create schedule for connection ${connection.id} (invalid sync interval)`,
      );
      return;
    }
    await this.windmill.createSchedule(connection.id, cron, true);
    this.logger.log(
      `Schedule created for connection ${connection.id} (${cron})`,
    );
  }

  /**
   * Called after a connection is updated.
   * Syncs the Windmill schedule state to match the connection's current settings.
   * Uses update-first to avoid a TOCTOU race between scheduleExists and create/update.
   */
  async onConnectionUpdated(connection: DataSource): Promise<void> {
    const { id, scheduleEnabled: enabled } = connection;
    const cron = this.toCron(connection);
    if (!cron) {
      // If toCron returns null, delete any existing schedule
      await this.windmill.deleteSchedule(id);
      this.logger.log(
        `Deleted schedule for connection ${id} (invalid sync interval)`,
      );
      return;
    }

    const wasUpdated = await this.windmill.updateSchedule(id, cron, enabled);
    if (wasUpdated) {
      this.logger.log(
        `Updated schedule for connection ${id} (${cron}, enabled=${enabled})`,
      );
    } else {
      await this.windmill.createSchedule(id, cron, enabled);
      this.logger.log(
        `Created schedule for connection ${id} during update (${cron}, enabled=${enabled})`,
      );
    }
  }

  /**
   * Called after a connection is archived/removed.
   * Deletes its Windmill schedule if one exists.
   */
  async onConnectionDeleted(connectionId: string): Promise<void> {
    await this.windmill.deleteSchedule(connectionId);
    this.logger.log(`Deleted schedule for connection ${connectionId}`);
  }

  /**
   * Deletes all Windmill schedules for a set of connection IDs (e.g. org deletion).
   * Failures are logged individually but do not abort the remaining deletions.
   */
  async deleteOrgSchedules(connectionIds: string[]): Promise<void> {
    const results = await Promise.allSettled(
      connectionIds.map((id) => this.windmill.deleteSchedule(id)),
    );
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Failed to delete schedule for connection ${connectionIds[i]}: ${String(result.reason)}`,
        );
      }
    });
  }

  /**
   * Triggers an immediate one-off run of the given connection.
   * Returns the Windmill job ID.
   */
  async triggerOnce(connectionId: string): Promise<string> {
    const jobId = await this.windmill.triggerOnce(connectionId);
    this.logger.log(
      `Triggered one-off job for connection ${connectionId}: jobId=${jobId}`,
    );
    return jobId;
  }

  /**
   * Entry point called by the internal scheduler controller when Windmill
   * invokes /internal/scheduler/execute-connection.
   */
  async executeConnection(
    connectionId: string,
  ): Promise<{ connectionId: string; status: string }> {
    this.logger.log(`Executing connection sync ${connectionId}`);
    try {
      const result = await this.syncRunner.run(connectionId);
      this.logger.log(
        `Connection ${connectionId} execution completed: status=${result.status}`,
      );
      return result;
    } catch (err) {
      this.logger.error(
        `Connection ${connectionId} execution failed: ${String(err)}`,
      );
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Converts a connection's syncIntervalMinutes to a cron expression.
   * Returns null and logs an error if the value is invalid so callers can
   * skip schedule operations cleanly rather than throwing mid-flight.
   */
  private toCron(connection: DataSource): string | null {
    if (!isSyncIntervalMinutes(connection.syncIntervalMinutes)) {
      this.logger.error(
        `Connection ${connection.id} has an unrecognised syncIntervalMinutes value: ` +
          `${String(connection.syncIntervalMinutes)}. Skipping schedule operation.`,
      );
      return null;
    }
    return intervalToCron(connection.syncIntervalMinutes);
  }
}
