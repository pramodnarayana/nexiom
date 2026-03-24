import type { ReplicationKeyType } from '@nexiom/connectors/framework';

/**
 * Re-export connector-framework types used by the cursor engine so consumers
 * only need to import from `@nexiom/engine`.
 */
export type {
  ReplicationKeyType,
  StreamDescriptor,
  PollWindow,
  PollRecord,
  PollPage,
} from '@nexiom/connectors/framework';

// ---------------------------------------------------------------------------
// Singer-style state document
// ---------------------------------------------------------------------------

/**
 * Per-stream high-water mark stored in `public.sync_cursors.state_document`.
 *
 * `offset` is the connector-specific pagination state persisted after each
 * intermediate checkpoint so the SchedulerWorker can resume at page N after
 * a crash rather than re-fetching from the replication_key_value bound.
 */
export interface StreamBookmark {
  replication_key: string;
  replication_key_value: string | number;
  replication_key_type: ReplicationKeyType;
  /** Connector-defined pagination state. Cleared on final checkpoint. */
  offset?: Record<string, unknown>;
}

/**
 * Top-level state document written to `public.sync_cursors.state_document`.
 * Matches the Singer state.py conventions.
 */
export interface SyncStateDocument {
  /** Per-stream high-water marks. */
  bookmarks: Record<string, StreamBookmark>;
  /** Per-stream ACTIVATE_VERSION counters (top-level, not inside bookmarks). */
  versions: Record<string, number>;
  /**
   * Stream name currently being synced. Set at run start; cleared on final
   * checkpoint. Non-null value on startup indicates a crashed run — the
   * SchedulerWorker uses `bookmark.offset` to resume pagination.
   */
  currently_syncing: string | null;
}

// ---------------------------------------------------------------------------
// Scheduler execution contracts
// ---------------------------------------------------------------------------

/** Payload sent by Windmill to POST /internal/scheduler/execute-stitch. */
export interface ExecuteStitchPayload {
  stitchId: string;
}

/** Result returned by the execute-stitch endpoint to Windmill. */
export interface ExecuteStitchResult {
  stitchId: string;
  /** 'started' = async pipeline launched; 'succeeded' = inline; 'skipped' = guard fired. */
  status: 'started' | 'succeeded' | 'skipped';
  streamResults?: StreamResult[];
}

/** Per-stream outcome within an ExecuteStitchResult. */
export interface StreamResult {
  streamName: string;
  recordsIngested: number;
  status: 'succeeded' | 'skipped' | 'failed';
  error?: string;
}

