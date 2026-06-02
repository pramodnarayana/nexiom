/**
 * Shared Redis lock key helpers for the scheduler module.
 *
 * These functions must be imported by every component that reads or writes
 * a scheduler lock (PollSyncRunner, CursorResetController).  A single
 * definition here prevents the key format from diverging across files.
 */

/** Redis key that guards per-stream poll execution. */
export function pollLockKey(dataSourceId: string, streamName: string): string {
  return `lock:poll:${dataSourceId}:${streamName}`;
}
