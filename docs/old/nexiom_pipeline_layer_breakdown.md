# Master Pipeline Execution: Revenova -> Multi-Destination (v3.4)

**Scenario:** A user creates an Account "Acme Trucking" in Revenova. We sync it to **QuickBooks (US)** and **HubSpot**.
**Architecture:** Consumer-Centric (Platform fetches data, App defines logic).
**Error Handling:** Queue-Based Notification (Store-First).

---

## 1. Standard Execution Flow

### Layer 1: Gateway Layer (Ingestion)

**Goal:** Capture the raw webhook safely and acknowledge receipt immediately.

#### 1. Endpoint & Trigger

* **URL:** `POST https://api.soopa.com/webhooks/tms/revenova/envoylogistics`
* **Payload:** Salesforce Outbound Message (XML/JSON)

#### 2. Platform Function (Infrastructure)

* **Name:** `ingest_webhook`
* **Logic:**
  1. **Context:** Resolves Tenant (`envoylogistics`) from URL.
  2. **Persist (Blocking):** Saves raw JSON to `Revenova_Gateway`.
  3. **Dispatch:** Pushes event to `Inbound_Gateway_Queue`.

#### 3. Failure Path (Technical)

* **Scenario:** Database is down or Write fails.
* **Action:** Return **HTTP 500** to Salesforce immediately.
* **Result:** Salesforce will retry the webhook later. No data loss.

#### 4. Queue Data (Pushed)

* **Queue:** `Inbound_Gateway_Queue`
* **Message:** `{ "tenant_id": "envoy", "source_app": "Revenova", "gateway_id": "gw-101" }`

---

### Layer 2: Replica Layer (Parsing)

**Goal:** Convert the messy "Raw Payload" into a clean "Replica Record" (a mirror of the source object).

#### 1. Platform Function (Infrastructure)

* **Name:** `replica_worker`
* **Logic:**
  1. Reads `source_app: Revenova`.
  2. **Fetch:** Retrieves full `gw-101` payload from DB.
  3. **Direct Call:** Loads `integrations/revenova/replica.ts`.
  4. **Execute:** Calls `UpsertRevenovaObject(payload)`.

#### 2. Application Function (Business Logic)

* **File:** `integrations/revenova/replica.ts`

  ```typescript
  import { DynamicReplicaUpsert } from '@fluxnex/core';

  export async function UpsertRevenovaObject(gatewayRecord) {
      // 1. Parse Object Type ("sf:Account")
      const rawObject = gatewayRecord.payload.Notification.sObject;
      const rawType = rawObject['xsi:type']; 
      
      // 2. Normalize Table Name ("sf_account")
      const tableName = rawType.replace('sf:', 'sf_').toLowerCase();

      // 3. Upsert (Platform helper handles the DB save + Queue Push)
      await DynamicReplicaUpsert(tableName, rawObject);
  }
