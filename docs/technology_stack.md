# Technology Stack & Infrastructure

## 1. Technology Stack Selection

| Component | Technology | Managed vs Own | Decision Rationale |
| :--- | :--- | :--- | :--- |
| **Backend Runtime** | Node.js (TypeScript) | **Own Code** | Type-safety, huge ecosystem, shared types between FE/BE. |
| **Frontend** | Next.js 14 (React) | **Own Code** | Best-in-class performance, SSR, easy Vercel/AWS deployment. |
| **Database (OLTP)** | PostgreSQL 16+ | **Managed (AWS RDS)** | Do NOT host your own DB. Need Point-in-Time Recovery and HA. |
| **Queue (Hot)** | Redis (BullMQ) | **Managed (ElastiCache)** | Low latency for rapid "Core Pipeline" events. |
| **Queue (Durability)**| AWS SQS (FIFO) | **Managed (AWS SQS)** | For "Outbound" queues where order + durability matters most. |
| **Notification** | Novu | **Managed (SaaS)** | Don't build email templates/routing from scratch. |
| **Secrets** | AWS Secrets Manager | **Managed (AWS)** | Rotate credentials safely. Never store in env vars. |

## 1.1 Queue Topology Map (Hybrid Strategy)
We use **SQS** for boundaries (Safety) and **BullMQ** for internal throughput (Speed).

| Queue Name | Layer | Technology | Rationale |
| :--- | :--- | :--- | :--- |
| `Inbound_Gateway_Queue` | **L1** | **AWS SQS** | **Durability**. If the system crashes, we must never lose a raw webhook. |
| `Source_Replica_Queue` | **L2** | **BullMQ (Redis)** | **Speed**. Internal handoff from L1 worker to L2 worker. Sub-millisecond latency. |
| `Normalised_Queue` | **L3** | **BullMQ (Redis)** | **Speed**. Heavy transformation processing. Easy retries/priorities in memory. |
| `Fetch_Request_Queue` | **L3** | **BullMQ (Redis)** | **Priority**. Source Fetcher needs to prioritize "blocking" dependencies. |
| `Outbound_Queue_[App]` | **L5** | **AWS SQS FIFO** | **Rate Limiting & Order**. We rely on SQS FIFO to ensure Invoice #1 comes before Invoice #2. |
| `Notification_Delivery` | **All** | **AWS SQS** | **Decoupling**. Don't let notification latency slow down the core pipeline. |

## 2. Infrastructure Architecture (AWS Reference)

This infrastructure is designed for **High Availability (HA)** and **Isolation**.

### 2.1 Compute Layout (Hybrid)
*   **Ingestion (Layer 1)**: **AWS Lambda**.
    *   *Why?* Bursty traffic. Webhooks come at unpredictable times. Scale to zero when idle.
*   **Core Processing (Layers 2-4)**: **AWS ECS (Fargate)**.
    *   *Why?* Long-running workers. Consistent load. Fargate removes server management.
*   **Delivery (Layer 5)**: **AWS ECS (Fargate)**.
    *   *Why?* Controlled throughput (Rate Limiting) is easier on persistent containers than Lambda.

### 2.2 Database Topography
*   **Instance**: AWS RDS for PostgreSQL (db.t4g.medium minimum).
*   **Schema Strategy**:
    *   **Catalog**: `fluxnex_master` (Tenants, Config).
    *   **Tenant Data**: Dynamic Schemas (e.g. `schema_tenant_a`, `schema_tenant_b`) inside the same cluster OR separate RDS instances for Enterprise clients.
*   **Connection**: All access via **AWS RDS Proxy** to prevent connection exhaustion from Serverless Lambdas.

### 2.3 Network & Security
*   **VPC**: Custom VPC with Public/Private Subnets.
*   **NAT Gateway**: Required for Private Subnet containers (Fargate) to reach External APIs (Salesforce, QB).
*   **WAF**: AWS WAF in front of API Gateway to block bot attacks.

### 2.4 The "Job Server" & Scheduler
You asked: *"Do we need a job server?"*
In this architecture, the **Fargate Containers** (`apps/worker`) act as the **Distributed Job Server**.

- **Processing**: The `Core Processing Service` containers consume the BullMQ/SQS queues. They *are* the job runners.
- **Scheduling (Polling)**: For apps without webhooks (e.g. older ERPs), we use **BullMQ Repeatable Jobs**.
    - A specific `Scheduler Service` (singleton container or leader-elected) injects "Trigger Jobs" into the `Inbound_Gateway_Queue` on a cron schedule (e.g. `*/5 * * * *`).
    - This removes the need for a separate heavy "Job Server" like Jenkins or Airflow.

### 2.4.1 Trace Example: Revenova Invoice Sync
Here is where the "Job Server" fits in for your specific case:

**Scenario A: Webhook (Real-Time)**
1.  **Revenova** calls webhook.
2.  **API Gateway** pushes to Queue (L1).
3.  **Job Server (Worker)**:
    *   *Picks up job*: "Parse Invoice #100".
    *   *Executes*: Runs `RevenovaUpsertObject`.
    *   *Completes*: Acks the job.

**Scenario B: Polling (Scheduled)**
1.  **Job Server (Scheduler)**:
    *   *Wakes up*: (e.g. at 5:00 PM).
    *   *Action*: Pushes a "Poll Job" to the Queue.
2.  **Job Server (Worker)**:
    *   *Picks up job*: "Fetch Invoices modified since 4:00 PM".
    *   *Executes*: Calls Revenova API -> Gets 50 Invoices -> Pushes 50 new jobs to L1 Queue.

## 3. Development vs Production

| Environment | DB | Queue | Compute | Cost Profile |
| :--- | :--- | :--- | :--- | :--- |
| **Local** | Docker Postgres | Docker Redis | Local Node Process | Free |
| **Staging** | RDS (Dev Tier) | ElastiCache (T3) | Fargate Spot Instances | Low ($50-100/mo) |
| **Production** | RDS (Multi-AZ) | ElastiCache (Primary) | Fargate + Lambda | Scale ($200+/mo) |
