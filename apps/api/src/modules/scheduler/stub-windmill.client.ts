import { Injectable, Logger } from '@nestjs/common';
import { WindmillClient } from './windmill.client.js';

/**
 * StubWindmillClient — in-memory no-op implementation.
 *
 * Injected when WINDMILL_ENABLED=false (local development / unit tests).
 * All write operations log a debug message and return immediately.
 * scheduleExists() always returns false so callers treat every connection as new.
 */
@Injectable()
export class StubWindmillClient extends WindmillClient {
  private readonly logger = new Logger(StubWindmillClient.name);

  ensureConnectionScript(): Promise<void> {
    this.logger.debug('StubWindmillClient: ensureConnectionScript (no-op)');
    return Promise.resolve();
  }

  createSchedule(
    connectionId: string,
    cron: string,
    enabled: boolean,
  ): Promise<void> {
    this.logger.debug(
      `StubWindmillClient: createSchedule connectionId=${connectionId} cron=${cron} enabled=${enabled}`,
    );
    return Promise.resolve();
  }

  updateSchedule(
    connectionId: string,
    cron: string,
    enabled: boolean,
  ): Promise<boolean> {
    this.logger.debug(
      `StubWindmillClient: updateSchedule connectionId=${connectionId} cron=${cron} enabled=${enabled}`,
    );
    // Stub has no persisted schedules — always report not found so callers fall back to create.
    return Promise.resolve(false);
  }

  setScheduleEnabled(connectionId: string, enabled: boolean): Promise<void> {
    this.logger.debug(
      `StubWindmillClient: setScheduleEnabled connectionId=${connectionId} enabled=${enabled}`,
    );
    return Promise.resolve();
  }

  scheduleExists(_connectionId: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  deleteSchedule(connectionId: string): Promise<void> {
    this.logger.debug(
      `StubWindmillClient: deleteSchedule connectionId=${connectionId}`,
    );
    return Promise.resolve();
  }

  triggerOnce(connectionId: string): Promise<string> {
    this.logger.debug(
      `StubWindmillClient: triggerOnce connectionId=${connectionId}`,
    );
    return Promise.resolve(`stub-job-${connectionId}`);
  }
}
