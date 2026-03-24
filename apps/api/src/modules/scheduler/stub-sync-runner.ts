import { Injectable, Logger } from '@nestjs/common';
import { SyncRunner, type SyncResult } from './sync-runner.js';

/**
 * StubSyncRunner — placeholder until CursorManagerService (T047) is implemented.
 * Returns 'started' immediately without running the sync pipeline.
 */
@Injectable()
export class StubSyncRunner extends SyncRunner {
  private readonly logger = new Logger(StubSyncRunner.name);

  run(stitchId: string): Promise<SyncResult> {
    this.logger.debug(
      `StubSyncRunner: run stitchId=${stitchId} (no-op until T047)`,
    );
    return Promise.resolve({ stitchId, status: 'started' });
  }
}
