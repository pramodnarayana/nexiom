import type { StreamResult } from '@nexiom/engine';

/**
 * SyncResult — outcome of a single stitch execution attempt.
 */
export interface SyncResult {
  stitchId: string;
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
 *   - PollSyncRunner  — real Singer-style poll pipeline (T030)
 *
 * Injected into SchedulerService to decouple execution from scheduling.
 */
export abstract class SyncRunner {
  abstract run(stitchId: string): Promise<SyncResult>;
}
