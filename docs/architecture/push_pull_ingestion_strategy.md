# Ingestion Strategy: Push vs. Pull (Hybrid Engine)

To provide a frictionless onboarding experience while supporting real-time workflows, FluxNex utilizes a Hybrid Ingestion Architecture.

Both Push (Webhooks) and Pull (Polling) mechanisms act as entry points. Crucially, they both converge at Layer 2 (Replica), meaning your normalization and outbound logic (Layers 3-5) never need to know how the data arrived.

## 1. The Pull Engine (Scheduled Polling)

The Pull Engine is the default for most integrations because it requires zero configuration from the customer aside from standard OAuth authentication.

### A. State Management (The Cursor)

To pull data efficiently, the platform must remember the last time it checked for updates. We store a "Cursor" (usually an ISO timestamp) in the database.

```typescript
// packages/database-schema/src/tenant/sync_cursor.ts
export const syncCursors = pgTable('sync_cursor', {
  id: uuid('id').defaultRandom().primaryKey(),
  connectionId: uuid('connection_id').notNull(), // Link to App_Connection
  entityType: varchar('entity_type').notNull(),  // e.g., 'sf_account'
  lastSyncTimestamp: timestamp('last_sync_timestamp').notNull(),
});
```

### B. The Execution Flow (Cron Job)

- **The Scheduler:** A BullMQ Repeatable Job runs every 15 minutes (or whatever interval the customer pays for).
- **The Fetcher:** The worker looks up the `lastSyncTimestamp` for the connection.
- **The API Call:** The worker uses the Activepieces/Connector framework to query the source API:
  `GET /services/data/v58.0/query/?q=SELECT+Id,Name+FROM+Account+WHERE+LastModifiedDate>'{cursor}'+ORDER+BY+LastModifiedDate+ASC`
- **Convergence:** The worker takes the array of returned records and drops them individually into the `Inbound_Gateway_Queue` (Layer 1) or directly to the `Source_Replica_Queue` (Layer 2).
- **Update Cursor:** The worker grabs the highest `LastModifiedDate` from the fetched batch and updates the `sync_cursor` table. The next cron run will start from there.

### C. Detecting New vs. Updated Records (The UPSERT)

A common challenge in building an iPaaS is knowing whether a record is newly created or just modified. The secret is: the Pull Engine doesn't care.

Most SaaS APIs (QuickBooks, Salesforce, HubSpot) do not have separate endpoints for "created" vs "updated" records. They simply update a `LastModifiedDate` timestamp for any change.

- **Fetch Everything Modified:** The engine grabs the list of all changed records and throws them into the queue.
- **The UPSERT Magic:** When the record reaches Layer 2 (Replica) and Layer 3 (Normalized), the database layer handles the difference using an UPSERT operation based on the Source App's ID (e.g., `sf-001`):
  - **If New:** The Source ID does not exist in your database. The ORM performs an `INSERT`.
  - **If Updated:** The Source ID already exists. The ORM performs an `UPDATE` to overwrite the old data with the fresh payload.

## 2. The Push Engine (Real-Time Webhooks)

The Push Engine is used for high-priority, real-time workflows, or for modern APIs (like Shopify or Stripe) that offer one-click webhook subscriptions via API.

### A. The Execution Flow

- **The Listener:** A webhook hits the API Gateway (`POST /webhooks/{app}/{tenantId}`).
- **Security:** The Gateway validates the HMAC signature or API key to ensure it actually came from the source app.
- **Convergence:** The Gateway drops the raw JSON payload directly into the `Inbound_Gateway_Queue` (Layer 1).

## 3. The Architecture Diagram

Both ingestion methods act as funnels into your existing 6-Layer pipeline. By separating the ingestion from the processing, you avoid writing duplicate data-mapping code.

```mermaid
graph TD
    subgraph Source ["Source Application (e.g., Salesforce)"]
        LiveEvent[User Edits Account]
        Historical[Historical Database]
    end

    subgraph IngestionLayer ["Layer 0: Ingestion Methods"]
        direction LR
        Push[Push / Webhook Receiver<br/><i>(Real-Time)</i>]
        Pull[Pull / Cron Poller<br/><i>(Every 15 mins)</i>]
        Cursor[(Sync Cursor DB)]
    end

    subgraph CorePipeline ["FluxNex Sync Engine"]
        L1[Layer 1: Gateway Queue]
        L2[Layer 2: Replica Worker]
        L3[Layer 3: Norm Worker]
    end

    %% Push Flow
    LiveEvent -->|Sends HTTP POST| Push
    Push -->|Raw JSON| L1

    %% Pull Flow
    Pull <-->|Reads/Updates Timestamp| Cursor
    Pull -->|Queries API: updated > Cursor| Historical
    Historical -->|Returns Array of JSON| Pull
    Pull -->|Splits into Individual Jobs| L1

    %% Convergence
    L1 --> L2
    L2 --> L3
    L3 -->|Standard Processing...| Outbound[...]

    classDef source fill:#f8fafc,stroke:#94a3b8;
    classDef ingest fill:#e0f2fe,stroke:#0ea5e9;
    classDef core fill:#f0fdf4,stroke:#22c55e;

    class Source source;
    class Push,Pull,Cursor ingest;
    class L1,L2,L3 core;
```

## 4. Edge Cases & Implementation Gotchas

When building the Pull Engine, you must account for these real-world scenarios:

- **The Clock Skew Buffer:**
  - *Problem:* If you pull exactly from 10:00:00, you might miss a record that was created at 09:59:59 but took 2 seconds to officially commit to the vendor's database.
  - *Solution:* Always subtract a "buffer" from your cursor. Query for `LastModifiedDate >= (Cursor - 2 minutes)`. Your downstream UPSERT logic safely handles pulling the same record twice without duplicating data.
- **Pagination is Critical:**
  - *Problem:* If a user bulk-updates 50,000 invoices, your query will time out.
  - *Solution:* The Pull Engine must utilize `limit` and `next_page_token`. It pulls 100 records, saves them, updates the cursor, and loops until the API says there are no more pages.
- **Hard Deletes (The Silent Killer):**
  - *Problem:* If a user deletes an Invoice in QuickBooks, the `LastModifiedDate` query will return nothing because the record no longer exists. The Pull Engine won't know it was deleted.
  - *Solution:* You must either rely on Webhooks (Push) for DELETE events, or query the specific "Deleted Entities" endpoints that enterprise APIs (like Salesforce `getDeleted()`) provide.
- **Initial Sync via Pull:**
  - Even if a customer configures Webhooks (Push) for real-time updates going forward, you must build a "Historical Sync" button in the UI that triggers a massive one-time Pull operation to ingest their legacy data.
- **Rate Limit Protection:**
  - Pulling data consumes API quotas. Ensure your scheduler checks the user's billing tier (e.g., Starter plan pulls every 1 hour, Enterprise pulls every 5 minutes) to protect both your infrastructure and their API limits.
