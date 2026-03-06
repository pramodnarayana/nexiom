# Implementation Plan: Intelligent Generic Trigger Engine

This document provides the concrete engineering roadmap to transition Nexiom from hardcoded webhook stubs to a 100% Intelligent Metadata-Driven polling engine, starting with Salesforce (8 triggers) and QuickBooks (5 triggers).

All file paths, function names, and API endpoints are grounded in the actual codebase.

---

## 0. Pre-conditions & Repository State

| Item | Current State | Required Before Start |
| --- | --- | --- |
| Salesforce triggers | 8 webhook stubs in `packages/pieces/salesforce/src/lib/trigger/` | No change — replace at end |
| QuickBooks triggers | 5 webhook stubs in `packages/pieces/quickbooks/src/triggers/` | No change — replace at end |
| Polling helper | `packages/connections/src/apps/salesforce/triggers/salesforce-polling.helper.ts` | Read-only reference |
| Bulk API helpers | `createBulkJob`, `getBulkJobInfo` in `packages/pieces/salesforce/src/lib/common/index.ts` | Read-only reference |
| `intelligence/` directory | Does not exist | Created in Task 1 |

---

## Phase 1: Intelligence Kernel (Salesforce) — Weeks 1–4

### Task 1.1 — Create `intelligence/` package scaffold

**Files to create:**

```text
packages/connections/src/intelligence/
  index.ts          ← barrel export
  optimization-registry.ts
  discovery-service.ts
  smart-cursor-selector.ts
  dynamic-query-builder.ts
  bulk-job-manager.ts
```

**Action:** Create the directory and empty barrel. No logic yet — establishes the import path for all subsequent tasks.

**Acceptance criteria:**

- `import { DiscoveryService } from '@nexiom/connections/intelligence'` resolves without TypeScript errors.
- All five service files export at least their type definitions.

---

### Task 1.2 — Implement `OptimizationRegistry`

**File:** `packages/connections/src/intelligence/optimization-registry.ts`

**What to build:**

- TypeScript interfaces: `ObjectHint`, `AppHints`, `OptimizationRegistry` (see design doc §3.1).
- Static `OPTIMIZATION_REGISTRY` constant with entries for Salesforce `Contact`, `Opportunity`, `Invoice__c` and QuickBooks `Invoice`.

**No external dependencies.** Pure TypeScript — no HTTP calls, no DB reads.

**Acceptance criteria:**

- `OPTIMIZATION_REGISTRY.salesforce.Contact.cursorPrecedence` returns `['SystemModstamp', 'LastModifiedDate']`.
- TypeScript compiles without errors.

---

### Task 1.3 — Implement `DiscoveryService`

**File:** `packages/connections/src/intelligence/discovery-service.ts`

**What to build:**

1. Interfaces: `FieldDescriptor`, `ChildRelationshipDescriptor`, `ObjectSchema` (see design doc §3.2).
2. `DiscoveryService` class with:
   - `describe(auth, objectName): Promise<ObjectSchema>` — calls `GET /services/data/v59.0/sobjects/{object}/describe`, normalises the response to `ObjectSchema`, caches for 15 minutes.
   - `fieldExists(auth, objectName, fieldName): Promise<boolean>` — cache-only lookup (re-fetches if expired).
   - `invalidate(objectName): void`.

**Reuse:** Use the same `fetch` pattern from `salesforce-polling.helper.ts:78` (not `httpClient`) to keep the service self-contained and testable without the full HTTP client middleware.

**Auth shape:** `SalesforceAuth` from `salesforce-polling.helper.ts:15–18` (`access_token`, `instance_url`).

**Acceptance criteria:**

- First call hits the API; second call within 15 min is served from cache (verify with a spy in unit tests).
- `fieldExists` returns `false` for a field not present in the schema.
- Cache is invalidated correctly and next call fetches fresh data.

---

### Task 1.4 — Implement `SmartCursorSelector`

**File:** `packages/connections/src/intelligence/smart-cursor-selector.ts`

**What to build:**

- Static class `SmartCursorSelector` with `pick(schema, hint?): string`.
- Default precedence: `['SystemModstamp', 'LastModifiedDate', 'CreatedDate']`.
- Falls back to `'Id'` if none found.

**Acceptance criteria (unit tests):**

| Schema has | Hint | Expected result |
| --- | --- | --- |
| `SystemModstamp`, `LastModifiedDate` | none | `SystemModstamp` |
| `LastModifiedDate` only | none | `LastModifiedDate` |
| `CreatedDate` only | none | `CreatedDate` |
| None of the above | none | `Id` |
| `LastModifiedDate` | `cursorPrecedence: ['CreatedDate', 'LastModifiedDate']` | `LastModifiedDate` (CreatedDate missing) |
| `CreatedDate`, `LastModifiedDate` | `cursorPrecedence: ['CreatedDate']` | `CreatedDate` |

---

### Task 1.5 — Implement `DynamicQueryBuilder`

**File:** `packages/connections/src/intelligence/dynamic-query-builder.ts`

**What to build:**

1. `QuerySpec` interface (see design doc §3.4).
2. `DynamicQueryBuilder.buildSOQL(schema, spec): string`
   - Always includes `Id` and `cursorField`.
   - If `requestedFields` is provided, intersects with schema `fields` to exclude unknown fields.
   - If `requestedFields` is absent, selects all `filterable` fields (avoids blob/base64 fields with `type === 'base64'`).
   - Appends sub-queries for each name in `spec.autoJoins` that exists in `schema.childRelationships`.
   - Appends `WHERE {cursorField} > {cursorValue} ORDER BY {cursorField} ASC LIMIT {limit}`.
3. `DynamicQueryBuilder.buildQBOQuery(entityType, spec): string`
   - Builds a simple `SELECT * FROM {entityType} WHERE MetaData.LastUpdatedTime > '{cursorValue}'` query.

**Security:** Import and call `assertSafeSalesforceObject` from `salesforce-polling.helper.ts:41` for `objectName` validation. Validate `cursorValue` matches ISO 8601 format with a regex before embedding in the query string.

**Acceptance criteria (unit tests):**

| Input | Expected SOQL fragment |
| --- | --- |
| Schema with Name, Email; no joins | `SELECT Id, SystemModstamp, Email, Name FROM Contact WHERE ...` |
| Schema with autoJoin `['OpportunityLineItems']` | `..., (SELECT Id, Quantity FROM OpportunityLineItems) FROM Opportunity WHERE ...` |
| `requestedFields: ['Name']` | `SELECT Id, SystemModstamp, Name FROM ...` |
| Object name `'; DROP TABLE'` | Throws `Error: Invalid Salesforce object name` |

---

### Task 1.6 — Implement `BulkJobManager`

**File:** `packages/connections/src/intelligence/bulk-job-manager.ts`

**What to build:**

1. `BulkJobCheckpoint` interface and `BulkJobState` type (see design doc §3.5).
2. `BulkJobManager.run(auth, soql, store): Promise<unknown[]>` — implements the state machine using the Bulk Query API directly:
   - Read checkpoint from `store.get('igt_bulk_job_checkpoint')`.
   - If `null` → `POST /services/data/v59.0/jobs/query` with `{ operation: 'query', query: soql }`, write checkpoint.
   - If `IN_PROGRESS` → `GET /services/data/v59.0/jobs/query/{jobId}`, check `state` field.
   - If `JobComplete` → call `downloadResults`, clear checkpoint, return records.
   - If `Failed` → clear checkpoint, throw error.
3. `downloadResults` — `GET /services/data/v59.0/jobs/query/{jobId}/results` with streaming response; parse NDJSON line-by-line into `unknown[]`.

**Do not reuse** the existing `createBulkJob` / `getBulkJobInfo` helpers from `common/index.ts` — those target the Bulk **Ingest** API (`/jobs/ingest/`) which is for writing data. Use the Bulk **Query** API endpoints directly (`/jobs/query/`) as specified in design doc §3.5.

**Acceptance criteria:**

- If a checkpoint exists with `IN_PROGRESS` state, no new job is created (verified via mock).
- Completed job returns records and clears the checkpoint from `TriggerStore`.
- Failed job clears checkpoint and throws a typed error.

---

### Task 1.7 — Implement Salesforce Universal Trigger

**File:** `packages/pieces/salesforce/src/lib/trigger/universal-trigger.ts`

**What to build:**
Full `createTrigger()` implementation following the execution lifecycle in design doc §4:

1. `assertSafeSalesforceObject(objectName)`
2. Load `OPTIMIZATION_REGISTRY.salesforce[objectName]`
3. `discoveryService.describe(auth, objectName)`
4. `SmartCursorSelector.pick(schema, hint)` → `cursorField`
5. `discoveryService.fieldExists` → schema drift guard
6. Read cursor from `store`, default to 24 h ago
7. `DynamicQueryBuilder.buildSOQL(schema, spec)`
8. Execute via REST (Path A) or hand off to `bulkJobManager.run()` (Path B)
9. Advance cursor to last record's `cursorField` value

**Props:**

- `object`: reuse `salesforcesCommon.object` dropdown from `common/index.ts` — no new API calls needed.

**Auth:** Use `SalesforceAuth` flat shape (`auth.access_token`, `auth.instance_url`).

**Acceptance criteria:**

- Running with `objectName = 'Contact'` produces SOQL containing `SystemModstamp` (from hint).
- Running with `objectName = 'CustomObject__c'` (not in registry) falls back to `SmartCursorSelector` default precedence.
- Schema drift: if `DiscoveryService.fieldExists` returns `false`, trigger returns `[]` without throwing.
- Integration test: mock Salesforce API, verify cursor is advanced after a successful run.

---

### Task 1.8 — Register Universal Trigger in Salesforce Piece Index

**File to modify:** `packages/pieces/salesforce/src/index.ts`

Add `salesforceUniversalTrigger` to the `triggers` array of the `createPiece()` call. Keep the 8 existing webhook stubs registered in parallel (do not delete yet — see Phase 3).

**Acceptance criteria:** `pnpm build` succeeds. The trigger appears in the Route Wizard under Salesforce.

---

## Phase 2: QuickBooks REST Polling — Weeks 5–7

### Task 2.1 — Implement QuickBooks polling helper

**File:** `packages/pieces/quickbooks/src/triggers/quickbooks-polling.helper.ts`

**What to build:**

- `runQuickBooksQuery(auth, entityType, store): Promise<unknown[]>` as specified in design doc §5.1.
- Cursor key: `igt_{entityType}_MetaData.LastUpdatedTime`.
- Default lookback: 24 hours (consistent with Salesforce helper).
- Calls `DynamicQueryBuilder.buildQBOQuery()` to generate the SQL string.
- Parses `body.QueryResponse` and flattens all entity arrays into a single `unknown[]` using the existing `QuickbooksEntityResponse<T>` type from `packages/pieces/quickbooks/src/lib/common.ts`.
- Advances cursor to `last.MetaData.LastUpdatedTime` of the last returned record (same source-timestamp pattern as Salesforce).

**Reuse:** `quickbooksCommon.getApiUrl(realmId)` from `packages/pieces/quickbooks/src/lib/common.ts`.

**Auth shape:** `{ access_token: string; realmId: string }` (derive from existing `quickbooksAuth` OAuth2 config).

**Acceptance criteria:**

- Mock query response with 3 Invoice records returns an array of 3 records.
- Cursor advances to the `MetaData.LastUpdatedTime` of the last record.
- Empty `QueryResponse` returns `[]` without error and does not advance the cursor.

---

### Task 2.2 — Implement QuickBooks Universal Trigger

**File:** `packages/pieces/quickbooks/src/triggers/universal-trigger.ts`

**What to build:**

```typescript
export const quickbooksUniversalTrigger = createTrigger({
    name: 'universal_trigger',
    displayName: 'New or Updated Record (Any Entity)',
    description: 'Fires when any QuickBooks entity is created or updated.',
    type: TriggerStrategy.POLLING,
    auth: quickbooksAuth,
    props: {
        entity: Property.Dropdown({
            displayName: 'Entity',
            required: true,
            options: async () => ({
                options: QB_SUPPORTED_ENTITIES.map(e => ({ label: e, value: e })),
            }),
        }),
    },
    async run(context) {
        const { auth, propsValue, store } = context;
        const entity = propsValue.entity as string;
        return runQuickBooksQuery(auth, entity, store);
    },
});
```

`QB_SUPPORTED_ENTITIES` is a constant listing all queryable QBO entities (Invoice, Customer, Payment, Expense, Deposit, Transfer, etc.).

**Acceptance criteria:**

- Running with `entity = 'Invoice'` builds and executes the correct QBO SQL query.
- Integration test: mock QBO query API, verify cursor is advanced, records returned.
- Running with an entity not in `OPTIMIZATION_REGISTRY` works correctly via the default path.

---

### Task 2.3 — Register QuickBooks Universal Trigger

**File to modify:** `packages/pieces/quickbooks/src/index.ts`

Add `quickbooksUniversalTrigger` to the `triggers` array. Keep existing 5 stubs registered in parallel.

---

## Phase 3: Global Expansion & Cleanup — Weeks 8–10

### Task 3.1 — Shadow Mode Infrastructure

**What to build:**
Add a `SHADOW_MODE` flag (env var `IGT_SHADOW_MODE=true`) to the universal trigger run function.

When enabled:

1. Run both the universal trigger path AND the real polling path (the actual poller implementation used in production).
2. Compare outputs using a deep-diff function.
3. Log any discrepancies to the workspace `gateway_logs` table (already used by `http-client.ts`).
4. Return results from the **real polling implementation** (or, if polling cannot run, fall back to polling-output-mock only for diffing and never as the returned production result).

**Acceptance criteria:**

- With `IGT_SHADOW_MODE=true`, both paths execute.
- Discrepancies are logged with `source: 'igt_shadow_diff'` in `gateway_logs`.
- With `IGT_SHADOW_MODE=false` (default), only the universal path executes.

---

### Task 3.2 — Data Parity Sign-Off

**Process (not a code task):**

1. Enable shadow mode for 5 business days on a staging workspace.
2. Review `gateway_logs` for `igt_shadow_diff` entries.
3. If zero discrepancies in 5 days → proceed to Task 3.3.
4. If discrepancies found → fix in universal trigger, restart the 5-day clock.

---

### Task 3.3 — Delete Hardcoded Trigger Stubs

**Files to delete (Salesforce):**

```text
packages/pieces/salesforce/src/lib/trigger/new-contact.ts
packages/pieces/salesforce/src/lib/trigger/new-lead.ts
packages/pieces/salesforce/src/lib/trigger/new-case-attachment.ts
packages/pieces/salesforce/src/lib/trigger/new-field-history-event.ts
packages/pieces/salesforce/src/lib/trigger/new-outbound-message.ts
packages/pieces/salesforce/src/lib/trigger/new-record.ts
packages/pieces/salesforce/src/lib/trigger/new-updated-record.ts
packages/pieces/salesforce/src/lib/trigger/new-updated-file.ts
```

**Files to delete (QuickBooks):**

```text
packages/pieces/quickbooks/src/triggers/new-invoice.ts
packages/pieces/quickbooks/src/triggers/new-expense.ts
packages/pieces/quickbooks/src/triggers/new-customer.ts
packages/pieces/quickbooks/src/triggers/new-deposit.ts
packages/pieces/quickbooks/src/triggers/new-transfer.ts
```

**Files to update after deletion:**

- `packages/pieces/salesforce/src/index.ts` — remove deleted triggers from `triggers` array.
- `packages/pieces/quickbooks/src/index.ts` — remove deleted triggers from `triggers` array.

**Acceptance criteria:** `pnpm build` succeeds. No references to deleted files remain.

---

### Task 3.4 — Generic Hint Abstraction for New Connectors

**File to update:** `packages/connections/src/intelligence/optimization-registry.ts`

Add a `defineHints(appName, hints): void` function so future connector developers can register hints from their own package without editing the central registry file:

```typescript
export function defineHints(appName: string, hints: AppHints): void {
    OPTIMIZATION_REGISTRY[appName] = { ...OPTIMIZATION_REGISTRY[appName], ...hints };
}
```

Add a `QuickBooks Hint Profile` example in a comment as documentation for new connector developers.

---

### Task 3.5 — Database-Backed Registry (Optional Upgrade)

**New migration file:** `packages/database/src/migrations/YYYYMMDD_add_connector_object_profiles.ts`

Schema:

```sql
CREATE TABLE connector_object_profiles (
    app_name    VARCHAR(100) NOT NULL,
    object_name VARCHAR(100) NOT NULL,
    profile     JSONB        NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
    PRIMARY KEY (app_name, object_name)
);
```

**Update `OptimizationRegistry`** to check the `connector_object_profiles` DB table first, fall back to the static `OPTIMIZATION_REGISTRY` map. Cache DB reads for 5 minutes in-process.

This task is optional for the initial launch but required before offering a self-service "custom hint" UI to enterprise customers.

---

## 4. Task Dependency Graph

```text
1.1 scaffold
  └─▶ 1.2 OptimizationRegistry
  └─▶ 1.3 DiscoveryService
        └─▶ 1.4 SmartCursorSelector
        └─▶ 1.5 DynamicQueryBuilder
              └─▶ 1.6 BulkJobManager
                    └─▶ 1.7 Universal Trigger (Salesforce)
                              └─▶ 1.8 Register in piece index
                                    └─▶ 2.1 QB polling helper
                                          └─▶ 2.2 QB Universal Trigger
                                                └─▶ 2.3 Register in piece index
                                                      └─▶ 3.1 Shadow Mode
                                                            └─▶ 3.2 Parity sign-off
                                                                  └─▶ 3.3 Delete stubs
                                                                  └─▶ 3.4 Hint abstraction
                                                                  └─▶ 3.5 DB registry (optional)
```

---

## 5. Testing Strategy

### Unit Tests (co-located with each service)

| Service | Key test cases |
| --- | --- |
| `SmartCursorSelector` | All 6 field presence combinations (see Task 1.4 table) |
| `DynamicQueryBuilder` | Valid SOQL output, sub-query injection, SOQL injection rejection |
| `DiscoveryService` | Cache hit/miss, TTL expiry, `fieldExists` true/false |
| `BulkJobManager` | State machine transitions, no double-job creation, result parsing |
| Universal Trigger (SF) | Schema drift return `[]`, cursor advancement, Bulk path selection |
| QB polling helper | Empty response, record parsing, cursor advancement |

### Integration Tests

- Mock Salesforce `describe` endpoint → verify `DiscoveryService` produces correct `ObjectSchema`.
- Mock Salesforce SOQL endpoint → verify `universal-trigger.run()` returns correct records and advances cursor.
- Mock QB query endpoint → verify `quickbooksUniversalTrigger.run()` returns records and advances cursor.

### Shadow Mode Validation (Phase 3)

- 5 business days of parallel execution on staging.
- Zero `igt_shadow_diff` log entries required before deletion of stubs.

---

## 6. Key Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Trigger file count | Reduce by 13 files (8 SF + 5 QB) | `git diff --stat` after Task 3.3 |
| SELECT field overhead | Reduce by ≥ 40% vs. current stubs | Compare field counts in SOQL logs |
| Custom object support | Zero developer changes for any `__c` object | Manual test with `CustomObject__c` |
| Bulk job correctness | Zero duplicate records on high-volume sync | Integration test with 6,000+ record mock |
| Schema drift recovery | Trigger resumes within 1 poll cycle after field restored | Unit test of self-healing path |
