import { Injectable, Logger } from '@nestjs/common';
import { SyncRunner, type SyncResult } from './sync-runner.js';

/**
 * StubSyncRunner — no-op placeholder used when WINDMILL_ENABLED=false.
 * Returns 'succeeded' immediately without executing the sync pipeline.
 */
@Injectable()
export class StubSyncRunner extends SyncRunner {
  private readonly logger = new Logger(StubSyncRunner.name);

  run(connectionId: string, _objectType?: string): Promise<SyncResult> {
    this.logger.debug(
      `StubSyncRunner: run connectionId=${connectionId} (no-op)`,
    );
    return Promise.resolve({ connectionId, status: 'succeeded' });
  }
}
