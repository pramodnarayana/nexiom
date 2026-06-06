export interface CursorRow {
  id: string;
  dataSourceId: string;
  streamName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectionMeta {
  syncIntervalMinutes: number;
  scheduleEnabled: boolean;
}

export interface EnrichedCursor extends CursorRow {
  ageMs: number;
  paused: boolean;
  stale: boolean;
}

export function computeCursorStaleness(
  rows: CursorRow[],
  meta: ConnectionMeta,
  nowMs: number = Date.now(),
): EnrichedCursor[] {
  const staleThresholdMs =
    meta.syncIntervalMinutes > 0
      ? 2 * meta.syncIntervalMinutes * 60_000
      : Number.POSITIVE_INFINITY;

  return rows.map((row) => {
    const ageMs = nowMs - row.updatedAt.getTime();
    // Paused connections are never stale — cursors are not expected to advance.
    const paused = !meta.scheduleEnabled;
    // Explicitly enumerate fields rather than spreading — stateDocument is
    // intentionally absent and must never appear in the HTTP response.
    return {
      id: row.id,
      dataSourceId: row.dataSourceId,
      streamName: row.streamName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ageMs,
      paused,
      stale: paused ? false : ageMs > staleThresholdMs,
    };
  });
}
