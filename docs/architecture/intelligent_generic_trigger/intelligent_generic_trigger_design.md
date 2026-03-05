# Detailed Design: Intelligent Generic Trigger Engine

This document provides the low-level technical specification for the FluxNex Intelligent Generic Trigger. This engine replaces hardcoded pollers with a metadata-aware runtime.

## 1. The Metadata Hint Registry (The Brain)

The registry stores "hacks" and "optimizations" for specific apps and objects. It allows the generic engine to behave as if it were custom-coded for high-performance entities.

### Schema: `public.connector_object_profiles`

| Column | Type | Description |
| --- | --- | --- |
| app_name | String | e.g., salesforce |
| object_name | String | e.g., Contact |
| profile | JSONB | Optimization profile containing strategy overrides and cursor precedence |
| updated_at | Timestamp | Last modified date |

### Example Entry: Salesforce Invoice (Profile JSON Payload)

```json
{
  "strategy_overrides": {
    "use_bulk_api_threshold": 10000,
    "auto_join": ["LineItems", "Account"],
    "prefer_api": "REST_V2"
  },
  "cursor_precedence": ["SystemModstamp", "LastModifiedDate", "Id"]
}
```

## 2. The Universal Runner Logic

The `universal-trigger.ts` handles the execution lifecycle. It follows this internal state machine:

### Step 1: Context Hydration

- Fetch the Connection Token.
- Query the Metadata Discovery Service to get the live schema of the target object.
- Load any Optimization Hints from the registry.

### Step 2: Smart Query Building

The `QueryBuilder` service constructs the SOQL/SQL string:

- **Fields:** Intersects the user's mapping requirements with the discovered fields to minimize payload size.
- **Joins:** If `LineItems` are mapped, it dynamically appends a sub-query (e.g., `(SELECT ... FROM LineItems)`).
- **Filters:** Injects the `LastModifiedDate > {cursor}` filter based on the best detected field.

### Step 3: Execution Path Selection

- **Path A (Standard):** Executes a standard REST request for `< 5,000` records.
- **Path B (Bulk 2.0):** If the API indicates a large dataset, the runner yields control to the `BulkJobManager`.
- **Path C (CDC/Stream):** If the app supports it, it switches to a Change-Data-Capture listener.

## 3. The High-Volume State Machine (Bulk API 2.0)

When the engine detects a massive sync requirement, it enters the Bulk Lifecycle:

1. **Job Initialization:** Worker calls `POST /jobs/ingest` and sends the dynamic query.
2. **Batching:** The engine streams IDs into the job.
3. **Checkpointing:** The `sync_cursor` is updated to `IN_PROGRESS_BULK` to prevent duplicate pollers from starting.
4. **Polling for Status:** A background worker monitors the job ID.
5. **Ingestion Stream:** Once complete, the engine downloads the result CSV/JSON and pipes it directly into the Layer 1 Gateway using a Node.js stream to avoid memory exhaustion.

## 4. Technical Challenges & Implementation Details

### Relational Depth (The "N+1" Killer)

Generic triggers often fail because they don't fetch linked records.

- **Solution:** The Discovery Service identifies Lookup and Master-Detail fields.
- **Logic:** If the Mapping UI contains a field path like `Account.Owner.Email`, the QueryBuilder automatically performs the join in the primary SOQL query rather than making separate calls.

### Schema Drift Management

SaaS schemas change.

- **Validation:** Before every poller run, the engine does a `HEAD` request to verify the `LastModifiedDate` field still exists.
- **Self-Healing:** If a field is deleted in Salesforce, the engine marks the Mapping as `DEGRADED` and notifies the user via Novu.

## 5. Engineering Requirements (The Kernel)

To support this design, we must implement these internal services:

- **DiscoveryService:** Caches and normalizes SaaS metadata into a FluxNex-standard JSON format.
- **QueryTranslator:** Converts FluxNex logic filters into app-specific syntax (SOQL, GraphQL, SQL).
- **StreamProcessor:** A utility to handle NDJSON/CSV streams for 1M+ record datasets.
