import { Action } from './action.js';
import { PieceAuthProperty } from './auth.js';
import { Trigger } from './trigger.js';
import { InternalServerErrorException } from '@nestjs/common';
import type { FieldDescriptor as BaseFieldDescriptor } from '../intelligence/interfaces.js';

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
 * The inclusive time/value window for a single poll run.
 * Both bounds are ISO-8601 strings for timestamp keys;
 * stringified numbers for numeric keys; raw tokens for opaque keys.
 */
export interface PollWindow {
    /** Buffered start value (cursor minus safety buffer for timestamps). */
    lowerBound: string;
    /** Upper bound — the exact moment the poll started; becomes next lowerBound. */
    upperBound: string;
    /** How the replication key should be interpreted. */
    replicationKeyType: ReplicationKeyType;
}

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
     * - `PollWindow.lowerBound` / `upperBound` are always `string` — numeric
     *   values are stringified before being stored or compared.
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
    /** Opaque cursor for the next page; undefined = last page. */
    nextPageCursor?: string;
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

/**
 * A single field within a SaaS object schema, as exposed by the Piece API.
 * Extends the intelligence-layer BaseFieldDescriptor with `label` for UI display.
 * `referenceTo` and all other base fields are inherited.
 */
export interface FieldDescriptor extends BaseFieldDescriptor {
    label: string;
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
     * Fetches one page of records from the source SaaS API within the given window.
     * The SchedulerWorker calls this once per page, advancing nextPageCursor until undefined.
     * Credentials are decrypted by the caller (TokenManagerService).
     *
     * `window.upperBound` is a **snapshot timestamp** fixed at the start of the run —
     * it does not advance between page calls. Implementations must use it as a stable
     * upper filter (e.g. `WHERE updated_at <= :upperBound`) on every page to ensure
     * records created during a long paginated run are not partially captured.
     * The SchedulerWorker commits `upperBound` as the next bookmark after a successful run.
     *
     * Implementors must guard against undefined `poll`: the SchedulerWorker validates
     * `typeof piece.poll === 'function'` at stitch creation time and rejects schedule
     * activation for pieces that do not implement polling.
     */
    poll?(credentials: Record<string, unknown>, window: PollWindow, nextPageCursor?: string): Promise<PollPage>;
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
    /** @see Piece.poll */
    poll?(credentials: Record<string, unknown>, window: PollWindow, nextPageCursor?: string): Promise<PollPage>;
}

/**
 * Mocks the exact Activepieces createPiece function.
 * Bundles the Auth definition, styling metadata, and executable Actions into a single registry object.
 */
export function createPiece(params: CreatePieceParams): Piece {
    // Convert Action array to a Record for O(1) invocation lookups
    const actionsMap = params.actions.reduce(
        (acc, action) => {
            if (acc[action.name]) {
                throw new InternalServerErrorException(`Duplicate action name: ${action.name}`);
            }
            acc[action.name] = action;
            return acc;
        },
        {} as Record<string, Action>,
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
            if (acc[trigger.name]) {
                throw new InternalServerErrorException(`Duplicate trigger name: ${trigger.name}`);
            }
            acc[trigger.name] = trigger;
            return acc;
        },
        {} as Record<string, Trigger>,
    );

    return {
        name: params.name || '',
        displayName: params.displayName,
        logoUrl: params.logoUrl,
        description: params.description || '',
        auth: params.auth,
        categories: (params.categories ?? []).map((cat) => {
            if (!Object.values(PieceCategory).includes(cat)) {
                throw new InternalServerErrorException(`Invalid PieceCategory: ${String(cat)}`);
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
        ...(params.poll && { poll: params.poll }),
    };
}
