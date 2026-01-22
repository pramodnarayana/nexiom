# Module: Core Sync Engine & Data Pipeline (v3.3)

## 1. Overview

The Sync Engine follows a **Domain-Driven Canonical Model** with a strict separation between **Generic Platform Infrastructure** and **Specific Integration Logic**.

* **Architecture:** 6-Layer Pipeline using the **Consumer-Centric** processing pattern.

* **Pattern:** **Router + Handler**. Generic workers dynamically load specific logic based on `source_app` or `entity_type`.

* **Validation:** **Late Validation** in Layer 3 (Data Availability), **Strict Gatekeeping** in Layer 4 (Business Validity).

* **Resilience:** Self-Healing Fetcher for missing dependencies.

## 2. The Data Pipeline Layers

### Layer 1: Gateway Layer (Generic Ingestion)

* **Role:** Pure I/O. No parsing. No business logic.

* **Trigger:** Webhook from Source App (e.g., Revenova).

  * **Endpoint Example:** `POST https://api.fluxnex.com/webhooks/tms/revenova/envoylogistics`

* **Action:**

  1. **Identify Context:** Resolve `tenant_id` (e.g. `envoylogistics`) from webhook URL.

  2. **Persist (Blocking):** Insert raw JSON into `[App]_Gateway` table.

     * *Failure Strategy:* Return HTTP 500 to Source.

  3. **Dispatch:** Send event to the shared **`Inbound_Gateway_Queue`**.

### Layer 2: Replica Layer (Source Parsing)

* **Role:** Converts Raw Stream into Structured Documents.

* **Trigger:** Consumes `Inbound_Gateway_Queue`.

* **Logic:**

  1. **Router:** Loads the App-Specific Entry Point (e.g. `revenova/replica.ts`).

  2. **Handler:** Calls the generic entry function `UpsertRevenovaObject(payload)`.

     * *Internal Logic:* Parses `xsi:type` to determine target table (e.g. `sf_account`).

  3. **Persist:** Saves to `Source_Record_Store`.

  4. **Dispatch:** Send event to `Source_Replica_Queue`.

### Layer 3: Normalized Layer (Canonical Mapping)

* **Role:** Transforms Source Data into the Canonical Platform Model.

* **Validation Strategy:** **Late Validation**. We save the record even if partial data is missing to ensure visibility.

* **Trigger:** Consumes `Source_Replica_Queue`.

* **Logic:**

  1. **Router:** Loads `router.ts` to determine the target Canonical Entity (e.g. `sf_account` + `Type=Vendor` -> `TMS_VENDOR`).

  2. **Handler:** Calls specific function `UpsertTMSVendor(data)`.

  3. **Dependency Check:** If parent records (e.g. Load) are missing, triggers **Layer 6 (Fetcher)** and pauses execution.

  4. **Persist:** Save to `Normalized_Entity`.

  5. **Dispatch:** Send event to `Normalised_Queue`.

### Layer 4: Outbound Gateway Layer (The Gatekeeper)

* **Role:** Maps Canonical Data to Destination Format & Validates Business Rules.

* **Trigger:** Consumes `Normalised_Queue`.

* **Logic:**

  1. **Route Lookup:** Queries `Integration_Routes` table to find destinations (e.g. QuickBooks, HubSpot).

  2. **Fan-Out:** Loops through each destination.

  3. **Handler:** Calls specific function `CreateQuickBooksVendorGatewayRecord(data)`.

  4. **Validation:** Checks mandatory fields. Throws **Business Error** if invalid.

  5. **Persist:** Insert into `[Dest_App]_Gateway` table with `target_name`.

  6. **Dispatch:** Send to `Outbound_Gateway_Queue_[App]`.

### Layer 5: Delivery Layer (Authenticated Execution)

* **Role:** Secure API Executor.

* **Trigger:** Consumes `Outbound_Gateway_Queue_[App]`.

* **Action:**

  1. **Connection Resolution:** Queries `App_Connection` table using the Logical Target Name from Layer 4.

  2. **Auth:** Decrypts Access Token. Handles Refresh if needed.

  3. **Execute:** Perform HTTP Request using method/endpoint from Gateway Record.

  4. **Update:** Update Gateway Status and `Global_Entity_Map`.

### Layer 6: Source Fetcher (Self-Healing)

* **Role:** Fetches missing or dependent data directly from the Source App API.

* **Trigger:** Consumes `Fetch_Request_Queue`.

* **Action:**

  1. **Execute:** Calls Source API (e.g., `GET /sobjects/Load/123`).

  2. **Inject:** Inserts the API Response into **Layer 1 (Gateway)**.

  3. **Recover:** Original pending record in Layer 3 retries automatically once data flows down.

## 3. Queue Topology

* **Ingestion:** `Inbound_Gateway_Queue` (Shared)

* **Internal:** `Source_Replica_Queue`, `Normalised_Queue`

* **Self-Healing:** `Fetch_Request_Queue` (Throttled)

* **Outbound:** `Outbound_Queue_QB.fifo`, `Outbound_Queue_HS.fifo` (Per Destination)

* **Notification:** `Notification_Delivery_Queue`
