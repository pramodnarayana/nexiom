# Core Sync Engine: High-Availability Multi-Tenant Pipeline

The FluxNex Sync Engine is the central nervous system of the platform. It is designed for infinite horizontal scalability, tenant-level data isolation, and self-healing resilience. It processes high-volume B2B data through a 6-layer decoupled pipeline.

## 1. Hybrid Ingestion Engine (Push & Pull)

Ingestion is the "Layer 0" that feeds the pipeline. To support real-time responsiveness and legacy data consistency, we use a hybrid approach.

### A. Push Engine (Real-Time Webhooks)

Optimized for low-latency events from modern SaaS (e.g., Salesforce, Shopify).

- **Ingress:** A specialized Lambda function or high-concurrency Gateway service listens at `POST /webhooks/{app}/{workspace_slug}`.
- **Validation:**
  - *Security:* Checks HMAC signatures or shared secrets defined in the `app_connection`.
  - *Context:* Resolves the `db_schema_name` from the `public.workspace` table.
- **L1 Persist:** Saves the raw, unparsed JSON payload and HTTP headers into the `inbound_gateway` table.
- **Immediate Response:** Returns an `HTTP 202 Accepted` to the source app immediately to minimize timeout risks.

### B. Pull Engine (Scheduled Polling)

Required for apps without webhooks (e.g., legacy ERPs) and for periodic "Historical Catch-up."

- **Scheduler:** A BullMQ repeatable job triggers based on the tenant's sync frequency (e.g., every 5 mins for Enterprise).
- **Cursor Logic:**
  - *Reads* `last_sync_timestamp` from the `sync_cursor` table.
  - *Buffer Skew:* Always subtracts a 2-minute buffer from the cursor (e.g., `updated_at > last_sync - 120s`) to account for database commit delays in the source app.
- **Pagination:** Utilizes a while loop that follows `next_page_token` or offset until the source API is exhausted.
- **Convergence:** Each individual record returned by the poll is treated as a discrete event and pushed into the Layer 1 Gateway buffer.

## 2. Module Separation: Platform vs. Application

To support 500+ apps, we strictly decouple the Infrastructure (Platform) from the Logic (Application).

### The Platform Module (`packages/engine`)

- **Responsibility:** "The Plumbing."
- **Tasks:** Queue management, database schema switching (`search_path`), distributed locks for OAuth refresh, JSON hydration logic, and error alerting (Novu).
- **Agnosticism:** This module does not know what an "Invoice" or "Salesforce" is.

### The Application Module (`packages/connectors/apps`)

- **Responsibility:** "The Intelligence."
- **Tasks:**
  - **Parsers:** Transforming raw XML/JSON into the Replica state.
  - **Action Definitions:** HTTP method, URL, and Property schemas (borrowed from Activepieces).
  - **Canonical Mappers:** Logic to move data from App-Specific schemas to the platform's `TMS_VENDOR`, `TMS_INVOICE`, etc.

## 3. The 6-Layer Deep Dive

Every record travels through these states, identified in the `Global_Entity_Map` by its `sourceReferenceId`.

### Layer 1: Gateway (Ingestion)

- **Storage:** `inbound_gateway`
- **Logic:** Pure I/O. Records the "Raw Truth" of what was received.
- **Handoff:** Pushes `{ gateway_id }` to `Inbound_Queue`.

### Layer 2: Replica (Source Structuring)

- **Storage:** `replica_entity` (JSONB)
- **Logic:** Loads the App-Specific Parser. Validates the payload against a Permissive Zod Schema (uses `.catchall(z.any())` to ensure custom fields like `Salesforce_Custom_ID__c` are captured).
- **Naming:** The record is assigned a `sourceReferenceId` (internal UUID).

### Layer 3: Normalized (Standardization)

- **Storage:** `normalized_entity` (JSONB)
- **Logic:** The "Router" picks a handler (e.g., `RevenovaToVendor`). Maps source fields to the strict Platform Canonical Model.
- **Late Validation:** If a non-critical field is missing, the record is still saved as `PARTIAL` to allow visibility in the dashboard.

### Layer 4: Outbound Prep (The Hydrator)

- **Logic:** Reads the user's Dynamic Mapping Template from the `field_mapping` table.
- **Hydration:** Uses a runtime engine (e.g., `lodash.get`) to replace template tags (e.g., `{{vendorName}}`) with real values from the Layer 3 record.
- **Handoff:** Pushes the fully-formed destination API payload to the `Delivery_Queue`.

### Layer 5: Delivery (Execution)

- **Logic:** The `PieceExecutor` takes over.
- **Auth Refresh:** Calls the `TokenManagerService`. If the token is expired, it acquires a Redis Distributed Lock to refresh the token once, even if 1,000 workers are running.
- **Execution:** Fires the HTTP request using the Activepieces Action definition.
- **Map Update:** Stamps the `destEntityId` (e.g., QuickBooks ID) into the `Global_Entity_Map`.

### Layer 6: Fetcher (Self-Healing)

- **Trigger:** If Layer 3 mapping fails because a dependent record is missing (e.g., an Invoice arrives but the "Load" doesn't exist yet).
- **Action:** Layer 3 pauses and sends a request to Layer 6.
- **Recovery:** Layer 6 makes a live GET call to the source API, retrieves the missing "Load," and injects it back into Layer 1. This restarts the chain, eventually unblocking the original Invoice.

## 4. Performance & Reliability Standards

- **Dead Letter Queues (DLQ):** Every queue (L1-L5) has a DLQ. After 5 failed retries with exponential backoff, the message is moved to the DLQ and an alert is sent to the Exception Center.
- **GIN Indexing:** The `data` JSONB columns in `replica_entity` and `normalized_entity` are GIN indexed, allowing support agents to search millions of records by a nested `invoice_number` in < 50ms.
- **Idempotency:** Layer 2 and Layer 3 use UPSERT logic keyed by `sourceApp` + `sourceId`. This ensures that if the same webhook is received twice, the system updates the existing record instead of creating duplicates.
