import type { TriggerStore, FieldDescriptor } from '@nexiom/piece-framework';
import type { ObjectHint } from './optimization-registry.js';



/** Describes a relationship to child records. */
export interface ChildRelationshipDescriptor {
    relationshipName: string;
    childSObject: string;
    field: string;
}

/** Agnostic representation of a SaaS object schema. */
export interface ObjectSchema {
    objectName: string;
    fields: FieldDescriptor[];
    childRelationships: ChildRelationshipDescriptor[];
    fetchedAt: number;  // TTL expiry
}

/** Defines how to build a polling data query. */
export interface QuerySpec {
    objectName: string;
    cursorField: string;
    cursorValue: string;
    requestedFields?: string[];
    autoJoins?: string[];
    limit?: number;
    omitLimit?: boolean;
    tieBreakerField?: string;
    tieBreakerValue?: string;
}

/** Discovers schema and checks for schema drift. */
export interface IDiscoveryAdapter<TAuth = unknown> {
    /** Returns the live schema for the given object. */
    describe(auth: TAuth, objectName: string, store?: TriggerStore): Promise<ObjectSchema>;

    /** Validates that the cursor field still exists in the live schema. */
    fieldExists(auth: TAuth, objectName: string, fieldName: string, store?: TriggerStore): Promise<boolean>;

    /** Invalidate cached schema (e.g., after a degraded mapping is repaired). */
    invalidate(auth: TAuth, objectName: string, store?: TriggerStore): void;
}

/** Constructs API-specific queries (e.g., SOQL, SQL). */
export interface IQueryAdapter {
    /** Builds a primary polling query string to fetch data. */
    buildQuery(schema: ObjectSchema, spec: QuerySpec): string;

    /** Builds a lightweight count query (optional, return empty string if not supported). */
    buildCountQuery(schema: ObjectSchema, spec: QuerySpec): string;
}

/** Information about the SaaS API rate limits. */
export interface ApiRateLimit {
    remaining: number;
    total: number;
}

/** Executes queries using Bulk APIs for high-volume loads. */
export interface IBulkAdapter<TAuth = unknown> {
    /** Starts or polls a bulk job and returns results when complete. Returns empty array if still polling. */
    runBulkJob(auth: TAuth, query: string, store: TriggerStore): Promise<unknown[]>;
}

/** Encapsulates the configuration for the Universal Trigger Engine execution. */
export interface UniversalTriggerConfig<TAuth = unknown> {
    auth: TAuth;
    store: TriggerStore;
    /** The SaaS object name to poll (e.g., "Contact", "Invoice") */
    objectName: string;
    /** The optimal hints from the OptimizationRegistry (optional) */
    hint?: ObjectHint;

    /** Executes the standard bounded query against the SaaS API. */
    executeStandardQuery: (auth: TAuth, query: string) => Promise<unknown[]>;

    /** Executes a lightweight count query. Optional. Returns total rows or 0. */
    executeCountQuery?: (auth: TAuth, query: string) => Promise<number>;

    /** Checks API limits to prevent over-polling. Optional. */
    checkApiLimits?: (auth: TAuth, store: TriggerStore) => Promise<ApiRateLimit | null>;

    /** Adapter to discover the schema. */
    discoveryAdapter: IDiscoveryAdapter<TAuth>;
    /** Adapter to build the query syntax. */
    queryAdapter: IQueryAdapter;
    /** Adapter to handle Bulk API execution. Optional. */
    bulkAdapter?: IBulkAdapter<TAuth>;

    /**
     * The fraction of API calls remaining below which polling pauses (0–1, default 0.2).
     * Replaces the Salesforce-specific SF_API_LIMIT_THRESHOLD env variable.
     */
    apiLimitThreshold?: number;

    /**
     * Human-readable connector/provider name used in log messages.
     * Defaults to objectName when not provided.
     */
    connectorName?: string;
}
