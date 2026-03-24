import { Injectable, Logger } from '@nestjs/common';
import { WindmillClient } from './windmill.client.js';

/**
 * StubWindmillClient — in-memory no-op implementation.
 *
 * Injected when WINDMILL_ENABLED=false (local development / unit tests).
 * All write operations log a debug message and return immediately.
 * scheduleExists() always returns false so callers treat every stitch as new.
 */
@Injectable()
export class StubWindmillClient extends WindmillClient {
  private readonly logger = new Logger(StubWindmillClient.name);

  ensureStitchScript(): Promise<void> {
    this.logger.debug('StubWindmillClient: ensureStitchScript (no-op)');
    return Promise.resolve();
  }

  createSchedule(
    stitchId: string,
    cron: string,
    enabled: boolean,
  ): Promise<void> {
    this.logger.debug(
      `StubWindmillClient: createSchedule stitchId=${stitchId} cron=${cron} enabled=${enabled}`,
    );
    return Promise.resolve();
  }

  updateSchedule(
    stitchId: string,
    cron: string,
    enabled: boolean,
  ): Promise<boolean> {
    this.logger.debug(
      `StubWindmillClient: updateSchedule stitchId=${stitchId} cron=${cron} enabled=${enabled}`,
    );
    // Stub has no persisted schedules — always report not found so callers fall back to create.
    return Promise.resolve(false);
  }

  setScheduleEnabled(stitchId: string, enabled: boolean): Promise<void> {
    this.logger.debug(
      `StubWindmillClient: setScheduleEnabled stitchId=${stitchId} enabled=${enabled}`,
    );
    return Promise.resolve();
  }

  scheduleExists(_stitchId: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  deleteSchedule(stitchId: string): Promise<void> {
    this.logger.debug(
      `StubWindmillClient: deleteSchedule stitchId=${stitchId}`,
    );
    return Promise.resolve();
  }

  triggerOnce(stitchId: string): Promise<string> {
    this.logger.debug(`StubWindmillClient: triggerOnce stitchId=${stitchId}`);
    return Promise.resolve(`stub-job-${stitchId}`);
  }
}
