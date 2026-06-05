import { Injectable, Logger } from '@nestjs/common';
import { ISchedulerClient } from '../interfaces/scheduler-client.interface.js';

/**
 * StubSchedulerClient — in-memory no-op implementation.
 *
 * Injected when WINDMILL_ENABLED=false (local development / unit tests).
 * All write operations log a debug message and return immediately.
 * scheduleExists() always returns false so callers treat every connection as new.
 */
@Injectable()
export class StubSchedulerClient implements ISchedulerClient {
  private readonly logger = new Logger(StubSchedulerClient.name);

  ensureConnectionScript(): Promise<void> {
    this.logger.debug('StubSchedulerClient: ensureConnectionScript (no-op)');
    return Promise.resolve();
  }

  createSchedule(
    connectionId: string,
    cron: string,
    enabled: boolean,
  ): Promise<void> {
    this.logger.debug(
      `StubSchedulerClient: createSchedule connectionId=${connectionId} cron=${cron} enabled=${enabled}`,
    );
    return Promise.resolve();
  }

  updateSchedule(
    connectionId: string,
    cron: string,
    enabled: boolean,
  ): Promise<boolean> {
    this.logger.debug(
      `StubSchedulerClient: updateSchedule connectionId=${connectionId} cron=${cron} enabled=${enabled}`,
    );
    // Stub has no persisted schedules — always report not found so callers fall back to create.
    return Promise.resolve(false);
  }

  setScheduleEnabled(connectionId: string, enabled: boolean): Promise<void> {
    this.logger.debug(
      `StubSchedulerClient: setScheduleEnabled connectionId=${connectionId} enabled=${enabled}`,
    );
    return Promise.resolve();
  }

  scheduleExists(_connectionId: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  deleteSchedule(connectionId: string): Promise<void> {
    this.logger.debug(
      `StubSchedulerClient: deleteSchedule connectionId=${connectionId}`,
    );
    return Promise.resolve();
  }

  triggerOnce(connectionId: string): Promise<string> {
    this.logger.debug(
      `StubSchedulerClient: triggerOnce connectionId=${connectionId}`,
    );
    return Promise.resolve(`stub-job-${connectionId}`);
  }
}
