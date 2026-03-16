# Deep Dive: The End-to-End Data Journey

This document details the precise technical operations—database writes, queue messages, and API calls—that occur during a single synchronization cycle.

---

## 1. The Execution Sequence Diagram

```mermaid
sequenceDiagram
    participant Source as Source App (Salesforce)
    participant API as API Gateway (NestJS/Fastify)
    participant SQS as Queue (SQS/BullMQ)
    participant Worker as Engine Workers
    participant Redis as Lock Manager
    participant DB_Pub as Postgres (Public Schema)
    participant DB_Silo as Postgres (ws_{id} Schema)
    participant Dest as Dest App (QuickBooks)

    Note over Source, API: [LAYER 1: INGESTION]
    Source->>API: HTTP POST Webhook
    API->>API: Generate Trace ID
    API->>DB_Silo: SET search_path TO ws_source; INSERT INTO inbound_gateway
    API->>SQS: Push { traceId, connectionId } to Inbound_Queue
    API-->>Source: 202 Accepted

    Note over Worker: [LAYER 2: REPLICA]
    SQS->>Worker: Consume Inbound_Queue
    Worker->>DB_Silo: SET search_path TO ws_source; UPSERT INTO replica_entity
    Worker->>SQS: Push { traceId } to Replica_Queue

    Note over Worker: [LAYER 3: NORMALIZATION]
    SQS->>Worker: Consume Replica_Queue
    Worker->>Worker: Map to Canonical (e.g., TMS_LOAD)
    Worker->>DB_Silo: SET search_path TO ws_source; INSERT INTO normalized_entity
    Worker->>SQS: Push { traceId } to Normalised_Queue

    Note over Worker: [LAYER 4: OUTBOUND PREP]
    SQS->>Worker: Consume Normalised_Queue
    Worker->>DB_Pub: SELECT * FROM integration_route WHERE src_id = ...
    Worker->>Worker: Evaluate sync_condition & Hydrate JSON
    Worker->>DB_Silo: SET search_path TO ws_dest; INSERT INTO outbound_gateway (request_payload, status='PENDING')
    Worker->>SQS: Push { traceId, outboundGatewayId } to Delivery_Queue

    Note over Worker, Dest: [LAYER 5: DELIVERY]
    SQS->>Worker: Consume Delivery_Queue
    Worker->>DB_Silo: SELECT request_payload FROM outbound_gateway WHERE id = ...
    Worker->>Redis: Acquire Refresh Lock (if expired)
    Redis-->>Worker: Lock Granted
    Worker->>Dest: POST /api/v3/invoice (External API Call)
    Dest-->>Worker: 201 Created { id: "QB-99" }

    Note over Worker, DB_Silo: [LAYER 6: DEST GATEWAY]
    Worker->>DB_Silo: SET LOCAL search_path TO ws_dest; UPDATE outbound_gateway (response_payload, status='SUCCESS')
    Worker->>DB_Pub: INSERT INTO public.global_entity_map (SF_ID <-> QB_ID)
```

---

## 2. Step-by-Step Technical Breakdown

### Step 1: Gateway Ingestion (L1)

- **Database Operation:** Saves the raw, unparsed JSON. This is "Source Evidence."
- **Queue Operation:** A small pointer message is sent to SQS.

### Step 2: Schema-Agnostic Replication (L2)

- **Database Operation:** Performs an `UPSERT` into the `replica_entity` table using JSONB + GIN Indexes.

### Step 3: Canonical Normalization (L3)

- **Logic:** Converts source-specific fields into the platform standard.
- **Database Operation:** Saves to `normalized_entity`.

### Step 4: The Routing Engine & Egress Evidence (L4)

- **Logic:** The worker queries the Public Schema for active Routes. It evaluates filters and the Hydrator builds the destination JSON.
- **Persistence (Critical):** Before finishing, Layer 4 switches the `search_path` to the Destination Silo and inserts a row into `outbound_gateway`.
  - Column `status`: Set to `PENDING`.
  - Column `request_payload`: Stores the hydrated JSON.
- **Result:** If the system crashes now, the UI shows the record as "Pending Delivery," and we have a record of exactly what we were about to send.

### Step 5: Authenticated Delivery (L5)

This phase handles the transition from internal data to the external internet.

- **Payload Retrieval:** The worker extracts the `request_payload` from the physical `outbound_gateway` table. This prevents payload size limits in the message queue and ensures data consistency.
- **Auth Handshake (The Refresh Lock):**
  1. The worker checks if the OAuth token for the destination is expired.
  2. If expired, it attempts a `SETNX` on Redis for `lock:refresh:{connection_id}`.
  3. Only one worker acquires the lock and calls the vendor's Token endpoint. Other concurrent workers for the same connection pause and poll Redis for the new token.
  4. The refreshed token is encrypted via AWS KMS and saved back to the `app_connection` table.
- **HTTP Execution:** The worker initializes the Activepieces Piece runtime. It executes the `run()` function, which performs the actual HTTP call to the target (e.g., QuickBooks).
- **Timeout & Retry:** If the target API returns a `429` (Rate Limit) or `503`, the worker throws a `RetryableException`, returning the message to the queue for exponential backoff.

### Step 6: The Global Entity Map & Final Audit (L6)

This phase "notarizes" the transaction results and updates the platform's relationship memory.

- **Outcome Logging:** The engine uses `SET LOCAL search_path TO {dataNamespace}` scoped to the transaction to update the `outbound_gateway` record created in L4, saving the `response_payload` and `status_code`. After the transaction commits, the search_path reverts automatically.
- **GEM Mapping (Idempotency):**
  1. The engine parses the external ID from the response (e.g., `QB-99`).
  2. It writes to `public.global_entity_map` — the GEM lives in the **control-plane public schema**, not in any tenant silo, because it links records across two different connections (source and destination).
  3. **The Moat:** If this Salesforce record is updated again later, the engine will check the GEM, find `QB-99`, and know to perform an `UPDATE` API call instead of a `CREATE` call, preventing duplicates in the customer's financial system.
- **Sync Ledger Completion:** The final entry is written to `sync_log` with a status of `COMPLETED`, which updates the "Green Checkmark" on the user's dashboard.

---

## 3. Physical Switching Logic (The "Magic")

The core of the end-to-end flow is the Storage Resolver. Every worker follows this pattern:

```typescript
async function process(job) {
  // 1. Resolve the dataNamespace (Postgres schema name) for this connection.
  const dataNamespace = await storageResolver.resolve(job.connectionId);

  // 2. Open a transaction and scope the search_path to this transaction only.
  //    SET LOCAL means the change is rolled back automatically when the
  //    transaction ends — the pooled connection's session search_path is
  //    never permanently altered, preventing tenant routing leaks.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(dataNamespace)}`);

    // 3. All subsequent DML in this transaction targets the correct silo.
    await tx.insert(outboundGateway).values({
      traceId: job.traceId,
      requestPayload: job.hydratedPayload,
      status: 'PENDING',
    });
  });
  // search_path reverts to the connection default after the transaction ends.
}
```

---

## 4. Error Recovery (The DLQ)

If any step fails (e.g., QuickBooks returns a `500`), the SQS message is returned to the queue. After 5 failed attempts, it moves to a Dead Letter Queue (DLQ). This triggers a notification to the customer's "Exception Center" in the UI.
