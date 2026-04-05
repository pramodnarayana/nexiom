import { Action } from './action.js';
import { PieceAuthProperty } from './auth.js';
import { Trigger } from './trigger.js';
import type { NormalizedRecord, VendorResponse } from './canonical/index.js';

export class PieceInternalServerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PieceInternalServerError';
    }
}

/** A SaaS object available for metadata discovery. */
export interface ObjectDescriptor {
    name: string;
    label: string;
    queryable: boolean;
}

// ---------------------------------------------------------------------------
// Polling framework types
// Used by piece.poll() and the SchedulerWorker (packages/engine).
// Defined here (packages/connectors) so that pieces can implement poll()
// without taking a dependency on packages/engine.
// ---------------------------------------------------------------------------

/**
 * Discriminator for how the replication key should be compared and formatted.
 * - `timestamp`: ISO-8601 string; `calculateWindow` applies the safety buffer.
 * - `numeric`:   Integer or float; compared as numbers, not strings.
 * - `opaque`:    Vendor-specific cursor (e.g. Salesforce queryLocator); passed through as-is.
 */
export type ReplicationKeyType = 'timestamp' | 'numeric' | 'opaque';

/**
 * The polling window passed to piece.poll() on each page call.
 *
 * Discriminated union keyed by `replicationKeyType` so connectors receive
 * only the bounds that are meaningful for their key type:
 *
 * - `timestamp` — ISO-8601 lower and upper bounds. `upperBound` is a snapshot
 *   fixed at run start; use it as `WHERE updated_at <= :upperBound` on every
 *   page. The SchedulerWorker commits `upperBound` as the next bookmark.
 * - `numeric`   — `lowerBound` only (stringified integer). There is no "now"
 *   upper bound for sequence IDs; connectors fetch forward from `lowerBound`.
 * - `opaque`    — `lowerBound` only (raw vendor cursor token, empty string on
 *   first run). Vendor controls semantics; no bound arithmetic is applied.
 */
export type PollWindow =
    | {
          replicationKeyType: 'timestamp';
          /** Buffered start — prior bookmark minus safety buffer (ISO-8601). */
          lowerBound: string;
          /**
           * Snapshot upper bound — fixed at the moment the run started (ISO-8601).
           * Use as a stable upper filter on every page to prevent partially
           * capturing records written during a long paginated run.
           */
          upperBound: string;
      }
    | {
          replicationKeyType: 'numeric';
          /** Last checkpointed sequence/integer value (stringified). `'0'` on first run. */
          lowerBound: string;
      }
    | {
          replicationKeyType: 'opaque';
          /** Raw vendor cursor token from the last checkpoint. `''` on first run. */
          lowerBound: string;
      };

/** A single record returned by piece.poll(). */
export interface PollRecord {
    /** Raw record payload from the source SaaS API. */
    data: Record<string, unknown>;
    /** The field name used as the replication key for this stream. */
    replicationKey: string;
    /**
     * The replication key value for this specific record.
     *
     * Coercion contract: implementers may return either `string` or `number`.
     * Internally the system treats these as follows:
     * - `PollWindow.lowerBound` is always `string`; `upperBound` only exists on
     *   the `timestamp` variant — numeric values are stringified before use.
     * - `CursorManagerService.trackHighWaterMark` calls `Number(value)` for
     *   `numeric` keys and `String(value)` for `timestamp` / `opaque` keys.
     * - The persisted `StreamBookmark.replication_key_value` is `string | number`
     *   and is stored as-is in JSONB; comparisons always use the type-aware path.
     *
     * Returning a `number` is safe for sequence IDs; returning a `string` is
     * required for ISO-8601 timestamps and opaque cursors.
     */
    replicationKeyValue: string | number;
}

/** One page of poll results for a named stream. */
export interface PollPage {
    streamName: string;
    records: PollRecord[];
    /**
     * Connector-specific pagination state to resume at the next page.
     * `undefined` means this is the last page.
     *
     * The SchedulerWorker persists this into `bookmark.offset` in `sync_cursors`
     * after each page (intermediate checkpoint), enabling crash-resume at page N
     * rather than re-fetching from the high-water mark.
     * Shape is connector-defined (e.g. `{ cursor: "abc123" }`, `{ page: 4 }`).
     */
    nextPageCursor?: Record<string, unknown>;
}

/**
 * Singer-style catalog entry for a single stream.
 * Returned by piece.describeStreams() so the SchedulerWorker can determine
 * replication strategy and key type before any state document exists.
 * Mirrors Singer catalog metadata fields:
 *   valid-replication-keys, replication-method, key-properties
 *
 * Discriminated union: INCREMENTAL requires replicationKey + replicationKeyType
 * at compile time so the SchedulerWorker never reaches calculateWindow with a
 * missing key. FULL_TABLE and LOG_BASED forbid these fields to prevent misuse.
 *
 * keyProperties must be non-empty — an empty array would give L2 no conflict
 * target for UPSERT deduplication.
 */
export type StreamDescriptor =
    | {
          streamName: string;
          replicationMethod: 'INCREMENTAL';
          /** The field name used as the bookmark. Must match PollRecord.replicationKey. */
          replicationKey: string;
          /** How the replication key value is compared and windowed. */
          replicationKeyType: ReplicationKeyType;
          /** Non-empty list of primary key fields for L2 UPSERT deduplication. */
          keyProperties: [string, ...string[]];
      }
    | {
          streamName: string;
          replicationMethod: 'FULL_TABLE' | 'LOG_BASED';
          replicationKey?: never;
          replicationKeyType?: never;
          /** Non-empty list of primary key fields for L2 UPSERT deduplication. */
          keyProperties: [string, ...string[]];
      };

export interface FieldDescriptor {
    name: string;
    label: string;
    type: string;
    filterable: boolean;
    sortable: boolean;
    nillable: boolean;
    referenceTo?: string[];
}

/**
 * Per-piece webhook signature configuration.
 * The WebhookSignatureGuard uses this to verify the vendor's HMAC-SHA256
 * signature before the request reaches the ingestion controller.
 */
export interface PieceWebhookConfig {
  /** Name of the environment variable holding the HMAC-SHA256 signing secret. */
  secretKeyEnv: string;
  /** HTTP header name that carries the vendor-generated signature (case-insensitive). */
  signatureHeader: string;
  /**
   * Encoding of the signature value in the header.
   * - `'base64'` (default) -- used by Salesforce and QuickBooks.
   * - `'hex'`              -- for vendors that emit lowercase hex digests.
   */
  signatureEncoding?: 'base64' | 'hex';
}

export interface Piece {
    name: string;
    displayName: string;
    logoUrl: string;
    description: string;
    /** Auth definition — required for any registered piece. */
    auth: PieceAuthProperty;
    /** Piece categories (e.g. ['SALES_AND_CRM']). */
    categories: PieceCategory[];
    actions: Record<string, Action>;
    triggers: Record<string, Trigger>;
    minimumSupportedRelease?: string;
    maximumSupportedRelease?: string;
    /** Returns available objects for this connection. Credentials are decrypted by the caller. */
    describeObjects?(credentials: Record<string, unknown>): Promise<ObjectDescriptor[]>;
    /** Returns the field schema for a specific object. */
    describeFields?(credentials: Record<string, unknown>, objectName: string): Promise<FieldDescriptor[]>;
    /**
     * Returns the Singer-style catalog for all streams this piece supports.
     * Called by SchedulerWorker before the first poll run to determine replication
     * strategy and key type without relying on existing state.
     */
    describeStreams?(credentials: Record<string, unknown>): Promise<StreamDescriptor[]>;
    /**
     * Converts a raw vendor record (from L2 replica) to Nexiom's canonical model.
     * Called by NormalizationService (L3) for each entity in the replica store.
     * Returns null if this piece does not normalize the given objectType
     * (e.g. a trigger-only piece without a canonical mapping).
     */
    normalize?(
        objectType: string,
        raw: Record<string, unknown>,
    ): Promise<NormalizedRecord | null>;
    /**
     * Executes a write action against the destination SaaS API.
     * Called by DeliveryService (L5) with the hydrated canonical payload.
     * Credentials are decrypted by TokenManagerService before this call.
     *
     * Implementers should throw a `RetryableException` for transient failures
     * (429, 503) and let non-retryable errors propagate as-is.
     */
    executeAction?(
        objectType: string,
        payload: Record<string, unknown>,
        credentials: Record<string, unknown>,
    ): Promise<VendorResponse>;
    /**
     * Fetches one page of records from the source SaaS API for the named stream.
     * The SchedulerWorker calls this once per page, passing the previous page's
     * `nextPageCursor` until `PollPage.nextPageCursor` is `undefined` (last page).
     * Credentials are decrypted by the caller (TokenManagerService).
     *
     * `streamName` identifies which object/stream to query (e.g. `'Account'`).
     * It matches `StreamDescriptor.streamName` and the `stream_name` key in `sync_cursors`.
     *
     * `window` is typed as a discriminated union — use `window.replicationKeyType`
     * to determine which bounds are available:
     *   - `'timestamp'`: both `lowerBound` and `upperBound` are ISO-8601 strings.
     *   - `'numeric'`:   only `lowerBound` (stringified integer); no `upperBound`.
     *   - `'opaque'`:    only `lowerBound` (raw vendor token); no `upperBound`.
     *
     * `nextPageCursor` is the connector-specific pagination state returned by the
     * previous `PollPage`. Shape is connector-defined and round-trips through
     * `bookmark.offset` in `sync_cursors` for crash-safe page resumption.
     *
     * The SchedulerWorker validates `typeof piece.poll === 'function'` at stitch
     * creation time and rejects schedule activation for non-polling pieces.
     */
    poll?(
        credentials: Record<string, unknown>,
        streamName: string,
        window: PollWindow,
        nextPageCursor?: Record<string, unknown>,
    ): Promise<PollPage>;
    /** Per-piece webhook signature configuration for HMAC verification. */
    webhook?: PieceWebhookConfig;
}

export enum PieceCategory {
    ARTIFICIAL_INTELLIGENCE = 'Artificial Intelligence',
    BUSINESS_INTELLIGENCE = 'Business Intelligence',
    COMMUNICATION = 'Communication',
    CORE = 'Core',
    DEVELOPER_TOOLS = 'Developer Tools',
    HUMAN_RESOURCES = 'Human Resources',
    MARKETING = 'Marketing',
    PRODUCTIVITY = 'Productivity',
    SALES_AND_CRM = 'Sales & CRM',
    ACCOUNTING = 'Accounting',
    FINANCE = 'Finance',
    OTHER = 'Other'
}

export interface CreatePieceParams {
    name?: string;
    displayName: string;
    logoUrl: string;
    authors?: string[];
    categories?: PieceCategory[];
    auth: PieceAuthProperty;
    actions: Action[];
    triggers: Trigger[];
    description?: string;
    minimumSupportedRelease?: string;
    maximumSupportedRelease?: string;
    describeObjects?(credentials: Record<string, unknown>): Promise<ObjectDescriptor[]>;
    describeFields?(credentials: Record<string, unknown>, objectName: string): Promise<FieldDescriptor[]>;
    /** @see Piece.describeStreams */
    describeStreams?(credentials: Record<string, unknown>): Promise<StreamDescriptor[]>;
    /** @see Piece.normalize */
    normalize?(objectType: string, raw: Record<string, unknown>): Promise<NormalizedRecord | null>;
    /** @see Piece.executeAction */
    executeAction?(objectType: string, payload: Record<string, unknown>, credentials: Record<string, unknown>): Promise<VendorResponse>;
    /** @see Piece.poll */
    poll?(
        credentials: Record<string, unknown>,
        streamName: string,
        window: PollWindow,
        nextPageCursor?: Record<string, unknown>,
    ): Promise<PollPage>;
    /** Per-piece webhook signature configuration for HMAC verification. */
    webhook?: PieceWebhookConfig;
}

/**
 * Mocks the exact Activepieces createPiece function.
 * Bundles the Auth definition, styling metadata, and executable Actions into a single registry object.
 */
export function createPiece(params: CreatePieceParams): Piece {
    // Convert Action array to a Record for O(1) invocation lookups
    const actionsMap = params.actions.reduce(
        (acc, action) => {
            if (Object.hasOwn(acc, action.name)) {
                throw new PieceInternalServerError(`Duplicate action name: ${action.name}`);
            }
            acc[action.name] = action;
            return acc;
        },
        Object.create(null) as Record<string, Action>,
    );

    const triggersMap = (params.triggers || []).reduce(
        (acc, trigger: Trigger) => {
            // Guard: skip entries that are not valid objects with a non-empty name
            if (
                typeof trigger !== 'object' ||
                trigger === null ||
                typeof trigger.name !== 'string' ||
                trigger.name.length === 0
            ) {
                console.warn('[createPiece] Skipping invalid trigger entry — missing or non-string name:', trigger);
                return acc;
            }
            if (Object.hasOwn(acc, trigger.name)) {
                throw new PieceInternalServerError(`Duplicate trigger name: ${trigger.name}`);
            }
            acc[trigger.name] = trigger;
            return acc;
        },
        Object.create(null) as Record<string, Trigger>,
    );

    // Validate webhook config at construction time so misconfigured pieces
    // fail immediately at startup rather than silently at request time.
    if (params.webhook !== undefined) {
        if (
            typeof params.webhook !== 'object' ||
            params.webhook === null ||
            typeof params.webhook.secretKeyEnv !== 'string' ||
            params.webhook.secretKeyEnv.trim().length === 0 ||
            typeof params.webhook.signatureHeader !== 'string' ||
            params.webhook.signatureHeader.trim().length === 0 ||
            (params.webhook.signatureEncoding !== undefined &&
                params.webhook.signatureEncoding !== 'base64' &&
                params.webhook.signatureEncoding !== 'hex')
        ) {
            throw new PieceInternalServerError(
                `[createPiece] Invalid webhook config for piece "${params.name}": ` +
                `secretKeyEnv and signatureHeader must be non-empty strings, ` +
                `and signatureEncoding (when present) must be 'base64' or 'hex'.`,
            );
        }
    }

    return {
        name: params.name || '',
        displayName: params.displayName,
        logoUrl: params.logoUrl,
        description: params.description || '',
        auth: params.auth,
        categories: (params.categories ?? []).map((cat) => {
            if (!Object.values(PieceCategory).includes(cat)) {
                throw new PieceInternalServerError(`Invalid PieceCategory: ${String(cat)}`);
            }
            return cat;
        }),
        actions: actionsMap,
        triggers: triggersMap,
        minimumSupportedRelease: params.minimumSupportedRelease,
        maximumSupportedRelease: params.maximumSupportedRelease,
        ...(params.describeObjects && { describeObjects: params.describeObjects }),
        ...(params.describeFields && { describeFields: params.describeFields }),
        ...(params.describeStreams && { describeStreams: params.describeStreams }),
        ...(params.normalize && { normalize: params.normalize }),
        ...(params.executeAction && { executeAction: params.executeAction }),
        ...(params.poll && { poll: params.poll }),
        ...(params.webhook && { webhook: params.webhook }),
    };
}
