/**
 * SyncResult — outcome of a single stitch execution attempt.
 */
export interface SyncResult {
  stitchId: string;
  /** 'started' = async pipeline launched, 'succeeded' = completed inline, 'skipped' = nothing to do */
  status: 'started' | 'succeeded' | 'skipped';
}

/**
 * Abstract SyncRunner.
 *
 * Implementations:
 *   - StubSyncRunner       — no-op used until CursorManagerService (T047) ships
 *   - CursorManagerService — real sync pipeline (pending T047)
 *
 * Injected into SchedulerService to decouple execution from scheduling.
 */
export abstract class SyncRunner {
  abstract run(stitchId: string): Promise<SyncResult>;
}
