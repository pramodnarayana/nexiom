import { Injectable, Logger } from '@nestjs/common';
import { SyncRunner, type SyncResult } from './sync-runner.js';

/**
 * StubSyncRunner — no-op placeholder used when WINDMILL_ENABLED=false.
 * Returns 'succeeded' immediately without executing the sync pipeline.
 */
@Injectable()
export class StubSyncRunner extends SyncRunner {
  private readonly logger = new Logger(StubSyncRunner.name);

  run(stitchId: string): Promise<SyncResult> {
    this.logger.debug(`StubSyncRunner: run stitchId=${stitchId} (no-op)`);
    return Promise.resolve({ stitchId, status: 'succeeded' });
  }
}
