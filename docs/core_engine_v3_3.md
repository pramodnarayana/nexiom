# Core Engine Module: Core Sync Engine & Data Pipeline (v3.3)

## 1. Overview
The Sync Engine follows a Domain-Driven Canonical Model with a strict separation between Generic Platform Infrastructure and Specific Integration Logic.

**Architecture**: 5-Layer Pipeline.
**pattern**: Router + Handler.
**Resilience**: Self-Healing integrated into Layer 3 (Source Dependencies) and Layer 5 (Destination SyncToken).

## 1.1 Multi-Tenancy Architecture (Database-per-Tenant)
The platform utilizes a **strict isolation** strategy.

- **Master Database (Catalog)**:
    - Shared. Stores `Tenants`, `Users`, `Billing`, `Integration_Config`.
    - Contains the *Connection String* for the Tenant's specific DB.
- **Tenant Database (Isolated)**:
    - One DB per Customer.
    - Stores **ALL** Sync Data: `[App]_Gateway`, `Normalized_Entity`, `Notification_Log`, `Sync_State`.
- **Platform Awareness**:
    - The Platform Worker middleware resolves the `tenant_id` -> Lookups Connection String -> Instantiates/Reuses a DB Client for *that* specific tenant.

## 2. The Data Pipeline Layers

### Layer 1: Gateway Layer (Generic Ingestion)
- **Role**: Pure I/O. No parsing. No business logic.
- **Trigger**: Webhook from Source App (e.g., Revenova).
- **Action**:
    1. **Identify Context**: Resolve tenant_id.
    2. **Persist (Blocking)**: Insert raw JSON into `[App]_Gateway`.
    3. **Consistency Check**: ONLY if Step 2 succeeds, proceed to Step 4.
    4. **Dispatch**: Send event to `Inbound_Gateway_Queue`.
- **Failure Strategy**:
    - If DB fails: Return 500. Do NOT push to queue.
    - If Queue push fails (rare): Log critical error (or use Transactional Outbox Pattern for 100% guarantee).
    - Result: Source retries later. No data loss.

### Layer 2: Replica Layer (Source Parsing)
- **Role**: Converts Raw Stream into Structured Documents.
- **Trigger**: Consumes `Inbound_Gateway_Queue`.
- **Logic**:
    - **Router/Handler**: Loads App-Specific logic (e.g., `revenova/replica.ts`) to parse data.
- **Persist**: Saves to `Source_Record_Store`.
- **Dispatch**: Send event to `Source_Replica_Queue`.

### Layer 3: Normalized Layer (Canonical Mapping & Source Self-Healing)
- **Role**: Transforms Data to Canonical Model & Resolves Dependencies.
- **Trigger**: Consumes `Source_Replica_Queue` AND `Fetch_Request_Queue`.
- **Logic (Normalizer)**:
    - **Validation**: Late Data Validation. checks for missing parent records (e.g. Load).
    - **Action**: If parent missing -> Push to `Fetch_Request_Queue`.
- **Logic (Source Fetcher - Self Healing)**:
    - **Trigger**: Consumes `Fetch_Request_Queue` (Internal).
    - **Action**: Calls Source API to fetch the missing object.
    - **Recovery**: Injects the fetched raw object back into **Layer 1 (Gateway)**. This ensures the dependent object flows through the full pipeline (Replica -> Normalized) and unblocks the original record.
- **Persist**: Save to `Normalized_Entity`.
- **Dispatch**: Send event to `Normalised_Queue`.

### Trace: Missing Dependency Flow (Example: Invoice -> Load)
1. **Detection**: Layer 3 Worker attempts to normalize *Invoice*. Looks up parent *Load* in DB. Result: `Missing`.
2. **Trigger**:
   - Worker pauses *Invoice* processing (NACKs message with delay).
   - Publishes event `Fetch(Entity=Load, ID=123)` to `Fetch_Request_Queue`.
3. **Fetching (Source Self-Healing)**:
   - `FetchWorker` consumes request. Calls Source API (`GET /Load/123`).
   - Receiver *Load* JSON.
   - **Injects** raw *Load* data into **Layer 1 (Gateway)** as if it were a new webhook.
4. **Resolution**:
   - The fetched *Load* flows normally: Gateway -> Replica -> Normalized (Created).
   - The original *Invoice* message (previously NACKed) is re-processed by Layer 3.
   - Dependency check now **Succeeds**. Invoice is created.

### Layer 4: Outbound Gateway Layer (The Gatekeeper)
- **Role**: Destination Mapping & Business Validation.
- **Trigger**: Consumes `Normalised_Queue`.
- **Logic**:
    - **Fan-Out**: Multiple destinations.
    - **Dynamic Mapping**: Applies Tenant Configuration (e.g., `Map: VendorInvoice.PayeeRef -> QB.DocNumber`).
    - **Validation**:
        - Checks if the *Mapped* source field exists (e.g., is `PayeeRef` reachable?).
        - **Exception Flow**: If a required mapped field is missing:
            1. **Stop Sync**: Do not create the Gateway record.
            2. **Notify**: Create a **System Notification** (visible in Dashboard).
            3. **Action**: User must fix data in Source or update Mapping config.
- **Persist**: Insert into `[Dest_App]_Gateway`.
- **Dispatch**: Send to `Outbound_Gateway_Queue_[App]`.

### Layer 5: Delivery Layer (Execution & Dest Self-Healing)
- **Role**: Secure API Executor & Destination Recovery.
- **Trigger**: Consumes `Outbound_Gateway_Queue_[App]`.
- **Logic**:
    - **Execute**: HTTP Request.
- **Self-Healing (Destination Fetcher)**:
    - **Scenario**: **SyncToken/Stale Error** from Destination.
    - **Action**: Catch error -> Fetch Latest from Dest -> Update Token -> Retry.

## 3. Queue Topology
- **Ingestion**: `Inbound_Gateway_Queue`
- **Internal**: `Source_Replica_Queue`, `Normalised_Queue`
- **Recovery**: `Fetch_Request_Queue` (Processed by Layer 3 Worker)
- **Outbound**: `Outbound_Queue_QB.fifo`, `Outbound_Queue_HS.fifo`
