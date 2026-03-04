# Detailed Design: Intelligent Generic Trigger Engine

This document provides the low-level technical specification for the Nexiom Intelligent Generic Trigger Engine. All type names, file paths, and API patterns are grounded in the actual codebase.

---

## 1. Current State & Baseline

### What Exists Today

| Layer | Location | Status |
|---|---|---|
| Trigger framework | `packages/connections/src/framework/trigger.ts` | Stable — `createTrigger`, `TriggerContext`, `TriggerStore` |
| HTTP client | `packages/connections/src/framework/http-client.ts` | Stable — rate limiting, retries, audit logging |
| Salesforce common | `packages/pieces/salesforce/src/lib/common/index.ts` | Has `getSalesforceFields`, `createBulkJob`, `getBulkJobInfo` |
| Salesforce polling helper | `packages/connections/src/apps/salesforce/triggers/salesforce-polling.helper.ts` | `runSalesforce()` with cursor management — extend this |
| Salesforce triggers | `packages/pieces/salesforce/src/lib/trigger/new-*.ts` (8 files) | Webhook stubs — replace with universal trigger |
| QuickBooks triggers | `packages/pieces/quickbooks/src/triggers/new-*.ts` (5 files) | Webhook stubs — replace with universal trigger |
| `TriggerContext.metadata.objectType` | `packages/connections/src/framework/trigger.ts:49` | Field already reserved for generic trigger |

### What Is Missing

1. **`DiscoveryService`** — Cached wrapper over Salesforce `DescribeSObject` / QuickBooks metadata APIs.
2. **`SmartCursorSelector`** — Picks the best polling cursor field from the live schema.
3. **`DynamicQueryBuilder`** — Builds SOQL/SQL queries from schema + user mappings (avoids `SELECT *`).
4. **`OptimizationRegistry`** — Per-object hint table that overrides default discovery behavior.
5. **`BulkJobManager`** — State machine using the Salesforce Bulk Query API (`/jobs/query/`) to read records at scale.
6. **`universal-trigger.ts`** (Salesforce) — Single `createTrigger()` replacing all 8 `new-*.ts` stubs.
7. **`universal-trigger.ts`** (QuickBooks) — Single `createTrigger()` replacing all 5 stubs, using REST polling.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Route Engine (cron / webhook)                │
└────────────────────────────┬────────────────────────────────────┘
                             │  TriggerContext { auth, propsValue,
                             │                  store, metadata }
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              universal-trigger.ts  (one per connector)           │
│                                                                  │
│  1. Load OptimizationRegistry hints for this object              │
│  2. Call DiscoveryService.describe(objectName)                   │
│  3. SmartCursorSelector.pick(schema, hints)  → cursorField       │
│  4. DynamicQueryBuilder.build(schema, hints) → query string      │
│  5. ExecutionPathSelector.run(query, hints)  → records[]         │
│  6. store.put(cursorKey, newCursor)                              │
└──────┬──────────┬──────────────────────────┬───────────────────┘
       │ Path A   │ Path B                   │ Path C
       ▼          ▼                          ▼
  REST query  BulkJobManager           CDC Listener
  (< 5 000)   (≥ 5 000 records)        (Salesforce only —
                                        future / opt-in via
                                        preferPath: 'CDC')
```

---

## 3. Component Specifications

### 3.1 OptimizationRegistry

**File:** `packages/connections/src/intelligence/optimization-registry.ts`

The registry is a typed in-process map. It is loaded at startup and can be hot-reloaded from the database `connector_object_profiles` table (Phase 3 upgrade).

```typescript
export type CursorStrategy = 'SystemModstamp' | 'LastModifiedDate' | 'CreatedDate' | string;
export type ExecutionPath  = 'REST' | 'BULK_V2' | 'CDC';

export interface ObjectHint {
    /** Force a specific cursor field instead of auto-selecting. */
    cursorPrecedence?: CursorStrategy[];
    /** Record threshold above which the engine switches to Bulk API 2.0. */
    bulkThreshold?: number;   // default: 5000
    /** Auto-join these child relationship names from DescribeSObject.childRelationships. */
    autoJoin?: string[];
    /** Force a specific execution path (overrides auto-detection). */
    preferPath?: ExecutionPath;
    /** Extra SELECT columns always included regardless of user mappings. */
    requiredFields?: string[];
}

export interface AppHints {
    [objectName: string]: ObjectHint;
}

export interface OptimizationRegistry {
    [appName: string]: AppHints;
}

export const OPTIMIZATION_REGISTRY: OptimizationRegistry = {
    salesforce: {
        Contact: {
            cursorPrecedence: ['SystemModstamp', 'LastModifiedDate'],
            requiredFields: ['Email', 'AccountId'],
        },
        Invoice__c: {
            cursorPrecedence: ['SystemModstamp'],
            autoJoin: ['InvoiceLineItems__r'],
            bulkThreshold: 10_000,
        },
        Opportunity: {
            autoJoin: ['OpportunityLineItems'],
            cursorPrecedence: ['SystemModstamp', 'LastModifiedDate'],
        },
    },
    quickbooks: {
        Invoice: {
            autoJoin: ['Line'],
            // preferPath: 'CDC' — only set if ≥ 5 entity types are polled simultaneously
        },
    },
};
```

**Database upgrade (Phase 3):** Add a `connector_object_profiles` table (JSONB) and replace the static map with a cached DB read. Schema:

| Column | Type | Example |
|---|---|---|
| `app_name` | `VARCHAR(100)` | `salesforce` |
| `object_name` | `VARCHAR(100)` | `Contact` |
| `profile` | `JSONB` | `{ "cursorPrecedence": ["SystemModstamp"] }` |
| `updated_at` | `TIMESTAMP` | — |

---

### 3.2 DiscoveryService

**File:** `packages/connections/src/intelligence/discovery-service.ts`

Wraps the existing `getSalesforceFields()` pattern (`/sobjects/{object}/describe`) with in-memory TTL caching to avoid re-describing the same object on every poll cycle.

```typescript
export interface FieldDescriptor {
    name: string;
    type: string;          // 'string' | 'datetime' | 'reference' | 'currency' | …
    filterable: boolean;
    sortable: boolean;
    nillable: boolean;
    referenceTo?: string[];
}

export interface ChildRelationshipDescriptor {
    relationshipName: string;  // e.g. 'OpportunityLineItems'
    childSObject: string;      // e.g. 'OpportunityLineItem'
    field: string;             // FK field on the child
}

export interface ObjectSchema {
    objectName: string;
    fields: FieldDescriptor[];
    childRelationships: ChildRelationshipDescriptor[];
    fetchedAt: number;  // Date.now() — for TTL expiry
}

export class DiscoveryService {
    private cache = new Map<string, ObjectSchema>();
    private readonly TTL_MS = 15 * 60 * 1000; // 15 minutes

    /**
     * Returns the live schema for the given Salesforce object.
     * Calls /sobjects/{object}/describe; caches for 15 minutes.
     * Auth shape matches SalesforceAuth from salesforce-polling.helper.ts.
     */
    async describe(auth: SalesforceAuth, objectName: string): Promise<ObjectSchema>;

    /**
     * Validates that the cursor field still exists in the live schema.
     * Called before every poll run as a lightweight schema drift check.
     */
    async fieldExists(auth: SalesforceAuth, objectName: string, fieldName: string): Promise<boolean>;

    /** Invalidate cached schema (call after a DEGRADED mapping is repaired). */
    invalidate(objectName: string): void;
}
```

**Salesforce endpoint used:** `GET /services/data/v59.0/sobjects/{object}/describe`
(upgrade from v56.0 used in `common/index.ts` — v59.0 adds `SystemModstamp` metadata).

**QuickBooks equivalent:** The QBO REST API v3 does not expose a full `describe` endpoint. `DiscoveryService` uses a static field manifest per entity type (embedded JSON). The cursor field is always `MetaData.LastUpdatedTime` — no schema discovery needed for QuickBooks.

---

### 3.3 SmartCursorSelector

**File:** `packages/connections/src/intelligence/smart-cursor-selector.ts`

```typescript
/** Default cursor preference order when no hint overrides. */
const DEFAULT_CURSOR_PRECEDENCE: string[] = [
    'SystemModstamp',
    'LastModifiedDate',
    'CreatedDate',
];

export class SmartCursorSelector {
    /**
     * Picks the best cursor field from the schema.
     * Respects the hint's cursorPrecedence list if provided.
     * Falls back to DEFAULT_CURSOR_PRECEDENCE, then 'Id'.
     */
    static pick(schema: ObjectSchema, hint?: ObjectHint): string {
        const precedence = hint?.cursorPrecedence ?? DEFAULT_CURSOR_PRECEDENCE;
        const fieldNames = new Set(schema.fields.map(f => f.name));

        for (const candidate of precedence) {
            if (fieldNames.has(candidate)) return candidate;
        }
        return 'Id';  // Last-resort append-only cursor
    }
}
```

**Cursor key convention:** `igt_{objectName}_{cursorField}` (e.g., `igt_Contact_SystemModstamp`).
Stored in `TriggerStore` (Redis-backed per the framework contract at `trigger.ts:27–31`).

---

### 3.4 DynamicQueryBuilder

**File:** `packages/connections/src/intelligence/dynamic-query-builder.ts`

Replaces the static SOQL string in `salesforce-polling.helper.ts:72–74` with a dynamic builder.

```typescript
export interface QuerySpec {
    objectName: string;
    cursorField: string;
    cursorValue: string;      // ISO timestamp or ID
    requestedFields?: string[]; // From user's mapping UI; undefined = all filterable fields
    autoJoins?: string[];     // Child relationship names from hint
    limit?: number;           // Default 200; set to 0 for Bulk path
}

export class DynamicQueryBuilder {
    /**
     * Builds a SOQL string from the QuerySpec.
     * Field list is the INTERSECTION of requestedFields and discoveredFields
     * so we never SELECT fields that don't exist.
     *
     * Example output:
     *   SELECT Id, SystemModstamp, Name, AccountId,
     *          (SELECT Id, Quantity, UnitPrice FROM OpportunityLineItems)
     *   FROM Opportunity
     *   WHERE SystemModstamp > 2025-01-01T00:00:00Z
     *   ORDER BY SystemModstamp ASC LIMIT 200
     */
    static buildSOQL(schema: ObjectSchema, spec: QuerySpec): string;

    /**
     * Builds a QuickBooks SQL query string (QBO uses a SQL-like syntax).
     * Example: SELECT * FROM Invoice WHERE MetaData.LastUpdatedTime > '2025-01-01'
     */
    static buildQBOQuery(entityType: string, spec: Omit<QuerySpec, 'autoJoins'>): string;
}
```

**SOQL injection safety:** All object names are validated with the existing regex from `salesforce-polling.helper.ts:13`:
`/^[A-Za-z0-9_]{1,80}$/`

Cursor values are ISO timestamp strings (format-validated before insertion).
Child relationship names are validated against `ChildRelationshipDescriptor.relationshipName` values returned from the live schema — never user-supplied strings.

---

### 3.5 BulkJobManager

**File:** `packages/connections/src/intelligence/bulk-job-manager.ts`

> **Important API distinction:** The existing helpers in `packages/pieces/salesforce/src/lib/common/index.ts` — `createBulkJob`, `uploadToBulkJob`, `notifyBulkJobComplete` — target the **Bulk Ingest API** (`/jobs/ingest/`), which is for *writing* records into Salesforce. For reading records at scale, we must use the **Bulk Query API** (`/jobs/query/`). `BulkJobManager` uses its own fetch calls to the query endpoints and does not reuse those helpers.

```typescript
export type BulkJobState =
    | 'IDLE'
    | 'IN_PROGRESS'
    | 'AWAITING_RESULTS'
    | 'FAILED';

export interface BulkJobCheckpoint {
    jobId: string;
    state: BulkJobState;
    soql: string;
    startedAt: string;  // ISO
}

export class BulkJobManager {
    /**
     * Checks TriggerStore for an in-progress Bulk job checkpoint.
     * If one exists, polls its status.
     * If complete, downloads results and returns records[].
     * If none exists, creates a new Bulk job for the given SOQL.
     */
    async run(
        auth: SalesforceAuth,
        soql: string,
        store: TriggerStore,
    ): Promise<unknown[]>;

    /** Stores IN_PROGRESS checkpoint so duplicate pollers skip this run. */
    private async checkpoint(store: TriggerStore, data: BulkJobCheckpoint): Promise<void>;

    /** Downloads Bulk Query result NDJSON, streams into records[]. */
    private async downloadResults(auth: SalesforceAuth, jobId: string): Promise<unknown[]>;
}
```

**Bulk Query API endpoints used (all read-only, separate from the Ingest API):**

| Operation | Endpoint |
|---|---|
| Create query job | `POST /services/data/v59.0/jobs/query` with `{ operation: 'query', query: soql }` |
| Poll job status | `GET /services/data/v59.0/jobs/query/{jobId}` |
| Download results | `GET /services/data/v59.0/jobs/query/{jobId}/results` |
| Abort job | `PATCH /services/data/v59.0/jobs/query/{jobId}` with `{ state: 'Aborted' }` |

**Checkpoint cursor key:** `igt_bulk_job_checkpoint` (per trigger instance in Redis).

**State machine:**

```
IDLE ──(TotalSize > threshold)──▶ IN_PROGRESS
                                     │
                                     │ (next poll cycle checks job status)
                                     ▼
                               AWAITING_RESULTS
                                     │
                                     │ (JobComplete = true)
                                     ▼
                                  IDLE (cursor advanced, checkpoint cleared)
                                     │
                         (JobFailed) ▼
                                  FAILED → emit error event
```

---

## 4. Universal Trigger: Execution Lifecycle

**File (Salesforce):** `packages/pieces/salesforce/src/lib/trigger/universal-trigger.ts`
**File (QuickBooks):** `packages/pieces/quickbooks/src/triggers/universal-trigger.ts`

```typescript
export const salesforceUniversalTrigger = createTrigger({
    name: 'universal_trigger',
    displayName: 'New or Updated Record (Any Object)',
    description: 'Fires when any record is created or updated in the selected Salesforce object.',
    type: TriggerStrategy.POLLING,
    auth: salesforceAuth,
    props: {
        object: salesforcesCommon.object,  // Existing dropdown from common/index.ts
        // Future: mappedFields — multiselect of fields to include
    },
    async run(context: TriggerContext) {
        const { auth, propsValue, store, metadata } = context;
        const objectName = propsValue.object as string;

        // 1. Validate object name (SOQL injection guard)
        assertSafeSalesforceObject(objectName);

        // 2. Load optimization hints
        const hint = OPTIMIZATION_REGISTRY.salesforce?.[objectName];

        // 3. Describe schema (cached 15 min)
        const schema = await discoveryService.describe(auth, objectName);

        // 4. Schema drift check — validate cursor field still exists
        const cursorField = SmartCursorSelector.pick(schema, hint);
        const driftOk = await discoveryService.fieldExists(auth, objectName, cursorField);
        if (!driftOk) {
            // Emit DEGRADED event via Novu and abort this run
            await emitDegradedMapping(metadata, cursorField);
            return [];
        }

        // 5. Read cursor from TriggerStore
        const cursorKey = `igt_${objectName}_${cursorField}`;
        const lastCursor = await store.get<string>(cursorKey)
            ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        // 6. Build SOQL (limit: 200 for REST path; omitted for Bulk path)
        const bulkThreshold = hint?.bulkThreshold ?? 5_000;
        const soql = DynamicQueryBuilder.buildSOQL(schema, {
            objectName,
            cursorField,
            cursorValue: lastCursor,
            autoJoins: hint?.autoJoin,
            limit: 200,  // Bulk path passes limit: undefined to omit the LIMIT clause
        });

        // 7. Choose execution path
        let records: unknown[];

        if (hint?.preferPath === 'CDC') {
            records = await runSalesforceCDC(auth, objectName, lastCursor, store);
        } else {
            // Run standard query; totalSize reflects the full result set even under LIMIT.
            // If the full set exceeds the threshold, rebuild without LIMIT and hand off to Bulk.
            const result = await runSalesforceQuery(auth, soql);
            if (result.totalSize >= bulkThreshold) {
                const bulkSoql = DynamicQueryBuilder.buildSOQL(schema, {
                    objectName,
                    cursorField,
                    cursorValue: lastCursor,
                    autoJoins: hint?.autoJoin,
                    limit: undefined,  // No LIMIT clause — Bulk API streams all records
                });
                records = await bulkJobManager.run(auth, bulkSoql, store);
            } else {
                records = result.records;
            }
        }

        // 8. Advance cursor
        if (records.length > 0) {
            const last = records[records.length - 1] as Record<string, unknown>;
            const nextCursor = last[cursorField];
            if (typeof nextCursor === 'string') {
                await store.put(cursorKey, nextCursor);
            }
        }

        return records;
    },
});
```

---

## 5. QuickBooks Polling Pattern

QuickBooks Online (QBO) v3 exposes a SQL-like query API that maps directly onto the same cursor pattern used for Salesforce. This keeps both connectors architecturally consistent and avoids a separate CDC parsing layer.

### 5.1 Standard REST Polling (Default)

**Query endpoint:** `GET /v3/company/{realmId}/query?query={sql}&minorversion=65`

```typescript
async function runQuickBooksQuery(
    auth: QuickBooksAuth,
    entityType: string,
    store: TriggerStore,
): Promise<unknown[]> {
    const cursorKey = `igt_${entityType}_MetaData.LastUpdatedTime`;
    const since = await store.get<string>(cursorKey)
        ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const sql = DynamicQueryBuilder.buildQBOQuery(entityType, {
        objectName: entityType,
        cursorField: 'MetaData.LastUpdatedTime',
        cursorValue: since,
        limit: 100,
    });

    const url = `${quickbooksCommon.getApiUrl(auth.realmId)}/query`
        + `?query=${encodeURIComponent(sql)}&minorversion=65`;

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${auth.access_token}`,
            Accept: 'application/json',
        },
    });

    const body = await response.json() as QuickbooksEntityResponse<unknown>;
    const records = Object.values(body.QueryResponse ?? {})
        .flat()
        .filter(v => typeof v === 'object') as unknown[];

    if (records.length > 0) {
        const last = records[records.length - 1] as Record<string, any>;
        const nextCursor = last?.MetaData?.LastUpdatedTime;
        if (nextCursor) await store.put(cursorKey, nextCursor);
    }

    return records;
}
```

**Generated SQL example:**

```sql
SELECT * FROM Invoice WHERE MetaData.LastUpdatedTime > '2025-01-01T00:00:00Z'
ORDER BY MetaData.LastUpdatedTime ASC MAXRESULTS 100
```

The QuickBooks Universal Trigger calls `runQuickBooksQuery` with the entity type selected by the user. The cursor field is always `MetaData.LastUpdatedTime` — QBO's universal modification timestamp, present on every entity type.

---

### 5.2 When to Use CDC Instead

CDC (`GET /v3/company/{realmId}/cdc?entities={list}&changedSince={timestamp}`) should be used in place of per-entity polling **only** when all of the following conditions are true:

| Condition | Threshold |
|---|---|
| Number of entity types monitored in a single trigger | ≥ 5 |
| Combined poll frequency across all entity types | ≥ every 2 minutes |
| QBO API quota pressure observed | Rate-limit errors in logs |

**Why CDC helps in this case:** A single CDC call returns changes for all entities simultaneously. At 5+ entity types polled every 2 minutes, per-entity polling would consume 5× the API quota. CDC collapses this to 1 call regardless of how many entity types are in the request.

**Why CDC is not the default:**

- CDC returns a server-side timestamp as the new cursor, not the record's own timestamp. This can cause gaps if the server clock differs from the record's `MetaData.LastUpdatedTime`.
- The response shape (`CDCResponse[].QueryResponse`) is structurally different from standard query responses, requiring a separate parsing path.
- For 1–4 entity types, the API quota savings are negligible.

**Implementation note:** If CDC is adopted in a future phase, it should be gated behind a field in `ObjectProfile` (`preferPath: 'CDC'`) and handled by a separate `runQuickBooksCDC` function, leaving the standard polling path unchanged.

---

## 6. Schema Drift Management

Before every poll run the engine calls `discoveryService.fieldExists()`. This is a lightweight check against the cached schema (no extra HTTP call unless the 15-minute TTL has expired).

**If the cursor field is missing:**

1. The trigger returns `[]` — no records processed, no data loss.
2. A `DEGRADED` event is emitted via the Novu notification service.
3. The mapping UI shows a warning badge on the affected Route.
4. On next run, the engine re-describes the object (cache invalidated) and attempts self-healing by picking the next available cursor from the precedence list.

---

## 7. Auth Shape Alignment

> **Important:** Two auth shapes currently coexist in the codebase.

| Location | Auth Access Pattern |
|---|---|
| `salesforce-polling.helper.ts` | `auth.access_token`, `auth.instance_url` (flat) |
| `common/index.ts` | `auth.data['instance_url']`, `auth['access_token']` (nested) |

The Universal Trigger standardises on the **flat shape** (`SalesforceAuth` from `salesforce-polling.helper.ts`) since the polling helper is the canonical reference implementation. The `common/index.ts` helpers will be updated to accept `SalesforceAuth` directly.

---

## 8. Engineering Requirements Summary

| Service | New File | Depends On |
|---|---|---|
| `OptimizationRegistry` | `packages/connections/src/intelligence/optimization-registry.ts` | Nothing |
| `DiscoveryService` | `packages/connections/src/intelligence/discovery-service.ts` | `httpClient`, `SalesforceAuth` |
| `SmartCursorSelector` | `packages/connections/src/intelligence/smart-cursor-selector.ts` | `DiscoveryService` types |
| `DynamicQueryBuilder` | `packages/connections/src/intelligence/dynamic-query-builder.ts` | `DiscoveryService` types, `assertSafeSalesforceObject` |
| `BulkJobManager` | `packages/connections/src/intelligence/bulk-job-manager.ts` | Salesforce Bulk Query API (own fetch calls — not the Ingest helpers) |
| Salesforce Universal Trigger | `packages/pieces/salesforce/src/lib/trigger/universal-trigger.ts` | All above |
| QuickBooks Universal Trigger | `packages/pieces/quickbooks/src/triggers/universal-trigger.ts` | `OptimizationRegistry`, `DynamicQueryBuilder`, `quickbooksCommon` |
| Intelligence barrel | `packages/connections/src/intelligence/index.ts` | All above |
