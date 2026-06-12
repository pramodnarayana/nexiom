# Soopa System Architecture (Master Context)

## 1. Product Identity

* **Name:** Soopa

* **Type:** Open Source Multi-Tenant B2B Integration Platform (iPaaS).

* **Goal:** A deployable framework to sync data between Source Apps (e.g., Revenova) and Destination Apps (e.g., QuickBooks) with high reliability.

## 2. Technology Stack

* **Repo:** Monorepo (Turborepo).

* **Frontend:** Refine + React 18 + Vite (`apps/web`).

* **Backend:** NestJS (`apps/api`) + Platform Kernel (`packages/core`).

* **Database:** PostgreSQL (Aurora Serverless v2).

* **ORM:** Drizzle ORM.

* **Auth:** Better-Auth (User/Org) + Grant (App Connectivity).

* **Queues:** Adapter Interface (AWS SQS for Cloud, Redis/BullMQ for Self-Hosted).

* **Compute:** Hybrid (Lambda for Ingest/Notify, ECS Fargate for Core).

## 3. Data Isolation Strategy (Critical)

We use a **Schema-per-Tenant** strategy for data isolation.

* **Public Schema:** Stores Identity (`user`, `organization`) and Platform config.

* **Tenant Schema (`tenant_{uuid}`):** Stores ALL integration data (`Gateway`, `Replica`, `Normalized`).

* **Context Injection:** The Platform Kernel injects the `tenant_id` into `AsyncLocalStorage` at the start of every request/worker. The ORM automatically selects the correct schema.

## 4. The 6-Layer Sync Pipeline

We follow a **Consumer-Centric** Event-Driven architecture.

1. **Layer 1 (Gateway):** Ingests raw webhooks. Blocking DB persist. Push to Queue. Endpoint: `POST /webhooks/tms/revenova/{tenant_id}`.

2. **Layer 2 (Replica):** Parses raw JSON into structured tables (e.g., `sf_account`). Uses a single generic handler per app (e.g., `UpsertRevenovaObject`).

3. **Layer 3 (Normalized):** Maps Source -> Canonical. Uses **Late Validation** (Save even if partial). Uses a Router to select the Handler (e.g., `UpsertTMSVendor`).

4. **Layer 4 (Outbound):** Maps Canonical -> Destination. Uses **Strict Validation** (Gatekeeper). Fan-out to multiple destinations. Uses logical target names (e.g., "QB US").

5. **Layer 5 (Delivery):** Executes API calls. JIT Connection/Auth lookup from `App_Connection` table.

6. **Layer 6 (Fetcher):** Self-healing sidecar for missing dependencies. Injects data back into Layer 1.

## 5. Mandatory Coding Patterns

* **The Router Pattern:** Do NOT use `if/else` chains to determine object types in generic workers. Use `router.ts` files to dynamically load specific Handler files based on conventions.

* **Implicit Context:** Application code must NEVER accept `tenantId` or `dbConnection` as parameters. It must use the Domain Helper functions that utilize `AsyncLocalStorage`.

* **Store-First Notification:** Never call Novu/Email APIs directly in a worker. Always `INSERT` to `Notification_Log` first, then push to `Notification_Queue`.

* **Domain Naming:** Use specific names like `UpsertTMSVendor` and `CreateQuickBooksVendorGatewayRecord` instead of generic names like `processRecord`.

## 6. Execution Roadmap (From Zero to Alpha)

### Phase 1: The Kernel & Identity (Weeks 1-3)

* **Goal:** Scaffolding, Multi-tenancy, and Schema Provisioning.

* **Tasks:**

  1. Initialize Monorepo (Turbo, NestJS, React).

  2. Implement `TenantService.provisionTenant()` (CREATE SCHEMA logic).

  3. Setup Better-Auth with PostgreSQL (Public Schema).

  4. Build "Users" and "Team" UI.

### Phase 2: App Connectivity & Security (Weeks 4-6)

* **Goal:** Securely connect external apps (OAuth).

* **Tasks:**

  1. Install **Grant** middleware for OAuth handshake.

  2. Implement KMS Encryption service for credentials.

  3. Build the **Connection Wizard** (Source -> Config -> Dest -> Config).

  4. Create `App_Connection` table logic.

### Phase 3: The Core Business Engine (Weeks 7-10)

* **Goal:** End-to-End Data Sync.

* **Tasks:**

  1. **Push Pipeline:** Layers 1-5 (Ingest, Replica, Norm, Outbound, Delivery).

  2. **Pull Pipeline:** Layer 6 (Fetcher) for self-healing.

  3. **Router Logic:** Implement `router.ts` and dynamic loading.

### Phase 4: Reliability & Feedback (Weeks 11-12)

* **Goal:** Observability and User Alerts.

* **Tasks:**

  1. Deploy **Novu** (Docker).

  2. Implement "Store-First" Notification Protocol.

  3. Build **Activity Log** and **Trace View** in Dashboard.

  4. Implement **Manual Retry** API.

### Phase 5: Billing & Monetization (Week 13+)

* **Goal:** Gating and Payments.

* **Tasks:**

  1. Deploy **Lago**.

  2. Instrument `delivery_worker` to send usage events.

  3. Configure Plans (Starter/Pro).
