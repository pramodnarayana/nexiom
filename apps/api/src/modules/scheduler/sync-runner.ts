import type { StreamResult } from '@soopa/pipeline';

/**
 * SyncResult — outcome of a single connection sync execution attempt.
 */
export interface SyncResult {
  connectionId: string;
  /** 'succeeded' = all streams polled; 'skipped' = lock contention; 'failed' = stream error. */
  status: 'started' | 'succeeded' | 'skipped' | 'failed';
  /** Per-stream outcomes. Present when the poll run sequence completes inline. */
  streamResults?: StreamResult[];
}

/**
 * Abstract SyncRunner.
 *
 * Implementations:
 *   - StubSyncRunner  — no-op placeholder used in tests / when poll is disabled
 *   - ConnectionSyncRunner  — real Singer-style poll pipeline per connection
 *
 * Injected into SchedulerService to decouple execution from scheduling.
 */
export abstract class SyncRunner {
  abstract run(connectionId: string, objectType?: string): Promise<SyncResult>;
  abstract fetchRecords(
    connectionId: string,
    objectType: string,
    recordIds: string[],
  ): Promise<SyncResult>;
}
