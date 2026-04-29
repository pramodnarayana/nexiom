# Nexiom CDC Pipeline Architecture

> Living document. Update as decisions evolve.  
> Created: 2026-04-19  
> Status: **APPROVED FOR IMPLEMENTATION**

## Guiding Decisions

| Decision | Choice |
|---|---|
| **Kafka migration threshold** | **50+ paying customers only.** No Kafka before that. |
| **Local dev requirement** | Every developer runs the **full end-to-end pipeline** on their laptop. One `docker-compose up`. |
| **Phase 1 target** | Debezium + SQS (LocalStack locally, AWS SQS in prod) |
| **Phase 2 trigger** | 50+ customers OR sustained >10k events/hour |

---

## Table of Contents

1. [Problem Statement — Current Architecture](#1-problem-statement--current-architecture)
2. [Pattern: Transactional Outbox + CDC Relay](#2-pattern-transactional-outbox--cdc-relay)
3. [Target Architecture — Phase 1 (Debezium + SQS)](#3-target-architecture--phase-1-debezium--sqs)
4. [Target Architecture — Phase 2 (Debezium + Kafka — 50+ customers only)](#4-target-architecture--phase-2-debezium--kafka--50-customers-only)
5. [Component Responsibilities](#5-component-responsibilities)
6. [Local Development Stack — Full Pipeline on a Laptop](#6-local-development-stack--full-pipeline-on-a-laptop)
7. [Production Stack (AWS)](#7-production-stack-aws)
8. [Multi-Tenant Schema Strategy](#8-multi-tenant-schema-strategy)
9. [Failure Scenarios & Recovery](#9-failure-scenarios--recovery)
10. [Migration Plan — Cron to CDC](#10-migration-plan--cron-to-cdc)
11. [Why Not Alternatives](#11-why-not-alternatives)

---

## 1. Problem Statement — Current Architecture

### The Broken Link

The Nexiom sync pipeline is correctly designed with **6 layers** and an **Outbox pattern** between each layer. However, the relay between L1 and L2 (and L2 and L3) is currently implemented as a **polling cron** — not an event-driven mechanism.

```
CURRENT (broken):
  inbound_gateway + inbound_outbox  ✅  written atomically
          ↓
  InboundOutboxService (cron, every 5s)  ❌  polling, not event-driven
          ↓
  SQS InboundQueue  ✅  correct
          ↓
  Worker (ReplicaService)  ✅  correct
```

### Why the Cron Is Wrong at Enterprise Scale

| Issue | Impact |
|---|---|
| **5-second latency** | L1→L2→L3 takes up to 15 seconds minimum. Unacceptable for near-real-time sync |
| **Not event-driven** | Wastes CPU on constant DB polling even with zero events |
| **Multi-pod unsafe** | Multiple API pods all poll simultaneously, causing contention on outbox rows |
| **Backpressure** | Under high load, cron cycles overlap and consume more connections than available |
| **Not horizontally scalable** | Adding more pods increases DB load, not throughput |

### What Enterprise-Grade Looks Like

```
TARGET:  
  INSERT into inbound_gateway   (API write)
          ↓  [WAL event fires in microseconds]
  Debezium reads Postgres WAL   (no polling, purely event-driven)
          ↓  [HTTP POST within ~10ms]
  AWS API Gateway               (serverless, auto-scaling, no compute)
          ↓  [direct SQS enqueue, no Lambda]
  SQS InboundQueue              (same queue, unchanged workers)
          ↓
  Worker (ReplicaService)       (unchanged)
```

---

## 2. Pattern: Transactional Outbox + CDC Relay

This is the **industry-standard enterprise pattern** for reliable event-driven pipelines with relational databases. Used by: Netflix, Grab, Airbnb, Shopify, Uber.

### Why the Outbox Table Exists

The fundamental problem: you cannot atomically write to a relational database AND publish a message to SQS in the same transaction. If SQS is temporarily unavailable, the event is lost.

**Solution:** Write the event to the database itself (outbox table) in the same transaction as the business row. A separate reliable relay reads the outbox and delivers to SQS.

```
                    ONE ATOMIC TRANSACTION
           ┌────────────────────────────────────┐
  API      │  INSERT inbound_gateway (payload)  │
  request  │  INSERT inbound_outbox  (traceId)  │  ← notification only — tiny row
           └────────────────────────────────────┘
                             ↓
                    SEPARATE RELIABLE RELAY
           Debezium reads WAL of inbound_outbox
           → publishes traceId to SQS
                             ↓
           Worker fetches full payload from inbound_gateway using traceId
```

### Why CDC Watches the Outbox, NOT the Business Table

This is a deliberate design decision:

| Watching Business Table (inbound_gateway) | Watching Outbox Table (inbound_outbox) |
|---|---|
| Large JSONB payloads flow through WAL | Tiny rows (just traceId, connectionId) through WAL |
| WAL becomes bloated under high load | WAL impact is minimal |
| CDC event payload = full business data | CDC event payload = just the notification key |
| Harder to filter duplicates | Outbox has built-in dedup semantics (ON CONFLICT DO NOTHING) |
| Complex schema changes break CDC | Outbox schema never changes |

---

## 3. Target Architecture — Phase 1 (Debezium + SQS)

This is the **immediate target architecture**. Zero new infrastructure beyond what runs in Docker locally.

### Full Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    SOURCE SIDE (L1 → L3)                        │
│                                                                 │
│  Salesforce Webhook / Manual Fetch                              │
│         ↓                                                       │
│  NestJS API                                                     │
│    ├── INSERT inbound_gateway  (full raw payload)   ┐          │
│    └── INSERT inbound_outbox   (traceId only)       ┘ atomic   │
│                                                                 │
│  ────────────────── CDC BOUNDARY ─────────────────────────────  │
│                                                                 │
│  Postgres WAL  (wal_level = logical)                            │
│         ↓  [inbound_outbox INSERT detected — microseconds]      │
│  Debezium Connect  (Docker / ECS)                               │
│    connector: nexiom-inbound-cdc                                │
│    table: *.inbound_outbox                                      │
│         ↓  HTTP POST  { traceId, connectionId, schemaName }     │
│  AWS API Gateway  /inbound-relay                                │
│    Integration: SQS SendMessage (no Lambda)                     │
│         ↓                                                       │
│  SQS InboundQueue  (LocalStack / AWS SQS)                       │
│         ↓                                                       │
│  Worker: ReplicaService  (Kafka consumer in Phase 2)            │
│    ├── reads full payload from inbound_gateway using traceId    │
│    ├── upserts to replica_entity                                │
│    ├── INSERT replica_outbox  (traceId)             ┐          │
│    └── [same CDC pattern repeats for L2 → L3]       ┘ atomic   │
│                                                                 │
│  Postgres WAL  (replica_outbox INSERT detected)                 │
│         ↓                                                       │
│  Debezium Connect                                               │
│    connector: nexiom-replica-cdc                                │
│    table: *.replica_outbox                                      │
│         ↓  HTTP POST                                            │
│  AWS API Gateway  /replica-relay                                │
│         ↓                                                       │
│  SQS ReplicaQueue                                               │
│         ↓                                                       │
│  Worker: NormalizationService                                   │
│    ├── reads from replica_entity using traceId                  │
│    └── upserts to normalized_entity                             │
└─────────────────────────────────────────────────────────────────┘
```

### What the Debezium HTTP POST Contains

```json
{
  "schema": { "type": "struct", "fields": [...] },
  "payload": {
    "before": null,
    "after": {
      "trace_id": "550e8400-e29b-41d4-a716-446655440000",
      "connection_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "status": "PENDING",
      "created_at": 1745074800000
    },
    "op": "c",
    "ts_ms": 1745074800123
  }
}
```

The NestJS endpoint (or API Gateway mapping template) extracts `trace_id` and `connection_id` and enqueues to SQS. The worker already knows how to process from there.

---

## 4. Target Architecture — Phase 2 (Debezium + Kafka — 50+ customers only)

> [!IMPORTANT]
> **This phase is explicitly deferred.** Do NOT plan Kafka infrastructure before reaching 50 paying customers or sustained >10k events/hour. Premature Kafka adoption adds operational overhead that slows a small team down.

When scale demands it, Kafka replaces SQS. **No changes to Debezium, no changes to outbox tables, no changes to business logic.** Only the sink and the worker consumer change.

```
PHASE 1 (current target):
  Debezium → HTTP → CdcRelayController → SQS → Worker (SQS consumer)

PHASE 2 (50+ customers):
  Debezium → Kafka → Worker (Kafka consumer, same business logic)
  CdcRelayController removed entirely
```

### What Changes in Phase 2

| Component | Phase 1 | Phase 2 |
|---|---|---|
| Debezium sink | `http` | `kafka` |
| API Gateway relay | Required | Removed |
| Worker consumer | SQS (`receiveMessage` poll) | Kafka consumer group |
| Message ordering | SQS FIFO (per group) | Kafka partition ordering |
| Replay capability | ❌ Not supported | ✅ Replay from any offset |
| Multi-pod concurrency | SQS visibility timeout | Kafka consumer group partition assignment |
| Local dev | LocalStack SQS | Local Kafka (KRaft mode) |
| Production | AWS SQS | AWS MSK (Managed Kafka) |

### Phase 2 Kafka Topic Design

```
nexiom.inbound_outbox.events   ← L1 → L2 relay
nexiom.replica_outbox.events   ← L2 → L3 relay
nexiom.outbound_outbox.events  ← L4 → L5 relay

Partition key: connectionId
→ All events for one connection land in the same partition
→ Guarantees strict processing order per source connection
```

---

## 5. Component Responsibilities

### Debezium Connect

| Property | Value |
|---|---|
| **Role** | WAL reader and event relay only. Zero business logic. |
| **Language/Runtime** | Java (Red Hat / IBM backed, 9k+ GitHub stars) |
| **Guarantee** | Reads WAL — survives crashes, restarts, network blips. Resumes from last committed WAL offset. |
| **Local image** | `debezium/connect:2.7` |
| **Production** | ECS Fargate task or EKS pod |
| **Config storage** | Kafka internal topics (Phase 1: embedded KV in local Debezium Server mode) |

### AWS API Gateway (Phase 1 only)

| Property | Value |
|---|---|
| **Role** | Stateless HTTP→SQS bridge. No compute, no code. |
| **Integration type** | AWS Service Integration (direct SQS SendMessage — no Lambda) |
| **Scalability** | Auto-scales with zero configuration. AWS-managed 99.99% SLA. |
| **Local equivalent** | LocalStack API Gateway (same REST API, emulated locally) |
| **Why not NestJS relay** | NestJS pod crash = missed events window. API Gateway never goes down. |

### Postgres WAL (Logical Replication)

| Property | Value |
|---|---|
| **Config change** | `wal_level = logical` (one line in `postgresql.conf`) |
| **Replication slot** | `nexiom_slot` — persists WAL position across Debezium restarts |
| **Publication** | `CREATE PUBLICATION nexiom_slot FOR TABLE inbound_outbox, replica_outbox` |
| **Slot retention** | WAL retained until slot consumer acknowledges — prevents data loss on Debezium downtime |
| **Risk** | If Debezium is down for extended periods with no WAL consumer, disk fills with retained WAL. Set `max_slot_wal_keep_size` to bound this. |

---

## 6. Local Development Stack — Full Pipeline on a Laptop

> [!IMPORTANT]
> Every developer must run the **complete** L1 → L2 → L3 pipeline end-to-end on their laptop without any cloud dependencies. No AWS account required. No special setup beyond `docker-compose up`.

### What Runs Where

```
Developer Laptop
├── docker-compose up
│   ├── postgres          ← already exists
│   ├── localstack        ← already exists (SQS)
│   └── debezium          ← NEW: one container added
│
└── pnpm dev:light
    ├── apps/api          ← NestJS API (includes new CdcRelayController)
    └── apps/worker       ← ReplicaService + NormalizationService
```

### Local CDC Flow

```
INSERT inbound_outbox
       ↓  [WAL, ~1ms]
Debezium Server (Docker)
       ↓  HTTP POST to NestJS (localhost:3000/internal/cdc/relay)
CdcRelayController (NestJS — single endpoint, table-based routing)
       ↓  SQS SendMessage
LocalStack SQS InboundQueue
       ↓
ReplicaService Worker
       ↓  [same CDC pattern]
LocalStack SQS ReplicaQueue
       ↓
NormalizationService Worker
```

> [!NOTE]
> **Why NestJS relay instead of LocalStack API Gateway?**  
> LocalStack's API Gateway → SQS service integration requires Pro tier and complex bootstrap scripts. Using a lightweight `CdcRelayController` in NestJS for local dev is simpler, easier to debug, and identical in behavior. In production, this controller is disabled and AWS API Gateway takes over — zero code difference in the workers or Debezium.

### docker-compose.yml Changes

```yaml
  # --- Debezium CDC Relay ---
  debezium:
    image: quay.io/debezium/server:2.7.4.Final
    platform: linux/amd64
    env_file:
      - .env
    volumes:
      - ./infra/debezium/application.properties:/debezium/conf/application.properties:ro
    depends_on:
      postgres:
        condition: service_healthy
      api:
        condition: service_started
    profiles: ["app"]
    networks:
      - nexiom-network
    restart: on-failure
    healthcheck:
      test: ["CMD-SHELL", "(echo > /dev/tcp/localhost/8080) >/dev/null 2>&1 || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  # --- LocalStack (SQS + KMS) ---
  # SQS queues are auto-created on startup via the init script.
  # Endpoint: http://localhost:4566 — matches INFRA_MODE=local in QueueService / AwsKmsAdapter.
  localstack:
    image: localstack/localstack:3.8
    environment:
      SERVICES: sqs,kms
      DEBUG: "0"
      DEFAULT_REGION: us-east-1
      LOCALSTACK_HOST: localstack
    ports:
      - "4566:4566"
    volumes:
      - localstack_data:/var/lib/localstack
      - ./scripts/init-localstack.sh:/etc/localstack/init/ready.d/init-localstack.sh
    healthcheck:
      test: ["CMD-SHELL", "awslocal sqs get-queue-url --queue-name delivery-queue --region us-east-1 && awslocal kms list-aliases --region us-east-1 | grep alias/nexiom-local"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    networks:
      - nexiom-network
```

### Debezium Server Configuration (Local)

```properties
# infra/debezium/application.properties

# Source: Postgres WAL
debezium.source.connector.class=io.debezium.connector.postgresql.PostgresConnector
debezium.source.database.hostname=postgres
debezium.source.database.port=5432
debezium.source.database.user=nexiom
debezium.source.database.password=nexiom
debezium.source.database.dbname=nexiom
debezium.source.plugin.name=pgoutput
debezium.source.publication.name=nexiom_slot
debezium.source.slot.name=nexiom_slot
debezium.source.table.include.list=*.inbound_outbox,*.replica_outbox
debezium.source.snapshot.mode=never

# Sink: HTTP → NestJS CdcRelayController (local dev)
debezium.sink.type=http
debezium.sink.http.url=http://api:3000/internal/cdc/relay
debezium.sink.http.timeout.ms=5000
debezium.sink.http.retry.count=5
debezium.sink.http.retry.delay.ms=1000

# Unwrap Debezium envelope — send only the new row values
debezium.transforms=unwrap
debezium.transforms.unwrap.type=io.debezium.transforms.ExtractNewRecordState
debezium.transforms.unwrap.drop.tombstones=true
debezium.transforms.unwrap.add.fields=table,schema
```

### Postgres Configuration (one line change)

```ini
# postgresql.conf or docker environment:
wal_level = logical   # changed from 'replica' (default)
```

```sql
-- Run once on DB init (add to migration scripts):
CREATE PUBLICATION nexiom_slot FOR TABLES IN SCHEMA public;
-- Tenant schemas are added dynamically: ALTER PUBLICATION nexiom_slot ADD TABLE ws_sf_abc.inbound_outbox;
```

### New NestJS Component: CdcRelayController

```typescript
// apps/api/src/modules/pipeline/cdc-relay.controller.ts
// Protected by CdcRelayGuard (DEBEZIUM_SECRET env var)
// Local dev only — in production, API Gateway handles this job

@Post('relay')
async relay(@Body() event: DebeziumUnwrappedEvent) {
  // Single endpoint — routes based on event.__table
  // if __table === 'inbound_outbox' → InboundQueue
  // if __table === 'replica_outbox' → ReplicaQueue
  // Uses schema_name from the outbox row (not Debezium __schema metadata)
}
```

### Developer Runbook — Full Pipeline Locally

```bash
# 1. Start all infrastructure (postgres, localstack, debezium)
docker-compose up -d

# 2. Start all app services
pnpm dev:light

# 3. Verify Debezium is healthy and connected to WAL
docker compose exec debezium curl -s http://localhost:8080/q/health   # Debezium Server health endpoint

# 4. Verify LocalStack SQS queues exist
aws --endpoint-url=http://localhost:4566 sqs list-queues

# 5. Trigger a test event (e.g., via the UI: create a stitch, fetch sample records)
# → Watch logs: Debezium fires → NestJS relay → SQS → worker processes → DB written

# 6. Check the data landed in the pipeline tables
pnpm --filter=api db:studio    # (or psql)
```

### Environment Variables

```bash
# .env (local)
DEBEZIUM_SECRET=local-dev-secret-change-in-prod
QUEUE_ENABLED=true              # Changed from false — workers now consume SQS
AWS_ENDPOINT_URL=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_REGION=us-east-1
INBOUND_QUEUE_URL=http://localhost:4566/000000000000/nexiom-inbound-queue
REPLICA_QUEUE_URL=http://localhost:4566/000000000000/nexiom-replica-queue
```

---

## 7. Production Stack (AWS)

```
RDS PostgreSQL (Outbox WAL)
       ↓  (WAL Logical Replication Stream — Sub-millisecond latency)
Debezium Server (ECS Fargate — single task, always-on)
       ↓  (HTTP POST — Secure Private VPC Link)
AWS API Gateway (HTTP API — Auto-scaling, Zero Maintenance)
       ↓  (Native SQS SendMessage Integration — No Lambda required)
Amazon SQS Queue (Highly Durable Queue)
       ↓  (Standard SQS Polling)
Workers (ECS Tasks — NormalizationService/ReplicaService)
```

### Production Debezium Task (ECS)

```json
{
  "family": "nexiom-debezium",
  "cpu": "256",
  "memory": "512",
  "networkMode": "awsvpc",
  "image": "debezium/server:2.7",
  "environment": [
    { "name": "DEBEZIUM_SOURCE_DATABASE_HOSTNAME", "value": "${RDS_ENDPOINT}" },
    { "name": "DEBEZIUM_SINK_HTTP_URL", "value": "${API_GATEWAY_URL}/inbound-relay" }
  ]
}
```

### Security

- Debezium ECS task has an IAM role allowing only `execute-api:Invoke` on the specific API Gateway resource
- API Gateway has a resource policy allowing only the Debezium task IAM role
- API Gateway is deployed as a **private** REST API (VPC endpoint only — no public internet exposure)
- SQS queues are configured with a resource policy allowing only the API Gateway service principal

---

## 8. Multi-Tenant Schema Strategy

Nexiom uses **per-connection Postgres schemas** (e.g. `ws_sf_abc123`). Each schema has its own `inbound_outbox` and `replica_outbox` tables.

### Debezium Publication Registration

Postgres `PUBLICATION` does not support wildcards across dynamic schemas. When a new tenant schema is provisioned:

```typescript
// Called by TriggerExecutorService.runOnEnable() after schema provisioning
await db.execute(sql`
  ALTER PUBLICATION nexiom_slot ADD TABLE ${tenantSchema}.inbound_outbox;
  ALTER PUBLICATION nexiom_slot ADD TABLE ${tenantSchema}.replica_outbox;
`);
```

Debezium automatically picks up the new table — no connector restart needed when using `pgoutput` plugin.

### Outbox Row Enhancement

The outbox row must include `schema_name` so the API Gateway → SQS message can be routed correctly by the worker:

```sql
-- inbound_outbox table (add schema_name column)
ALTER TABLE inbound_outbox ADD COLUMN schema_name varchar(128) NOT NULL DEFAULT current_schema();
```

Workers use `schema_name` to run `SET LOCAL search_path` before querying the business table.

---

## 9. Failure Scenarios & Recovery

### Scenario 1: Debezium Goes Down

```
Impact: No WAL events published to API Gateway / SQS.
        inbound_outbox rows accumulate as PENDING.
        Workers idle — no new messages.

Recovery: When Debezium restarts, it reads WAL from the last acknowledged LSN.
          All missed events are replayed automatically.
          Workers process the backlog normally.
          Zero data loss. Zero manual intervention.
```

### Scenario 2: SQS / API Gateway Unavailable

```
Impact: Debezium HTTP POST fails. Debezium retries with backoff.
        WAL replication slot keeps accumulating (disk impact — monitor closely).

Recovery: When SQS recovers, Debezium retries and drains the backlog.
          Set CloudWatch alarm on replication slot lag > 10MB.
```

### Scenario 3: Worker Crashes Mid-Processing

```
Impact: SQS message not deleted → becomes visible again after visibility timeout.
        Worker picks it up again.

Recovery: Workers use ON CONFLICT DO UPDATE — processing is idempotent.
          Same traceId processed twice produces the same result. No duplicates.
```

### Scenario 4: Postgres Restart (WAL Slot Survives)

```
Impact: None. Replication slot persists across Postgres restarts.
        Debezium reconnects and continues from last LSN.
        No data loss.
```

---

## 10. Migration Plan — Cron to CDC

### Phase 0: Preparation (No service interruption)

- [ ] Add `wal_level = logical` to Postgres config + restart (requires DB restart — plan maintenance window)
- [ ] Add `schema_name` column to `inbound_outbox` and `replica_outbox`
- [ ] Add Debezium Server to `docker-compose`
- [ ] Set up LocalStack API Gateway → SQS integration script
- [ ] Register Debezium connector via REST API call on startup

### Phase 1: Run Both in Parallel

- [ ] Enable Debezium connector — CDC events now flow to SQS alongside cron
- [ ] Workers handle duplicate messages gracefully (already idempotent via ON CONFLICT)
- [ ] Monitor for 1 week — verify CDC events arrive within 50ms of INSERT

### Phase 2: Remove Cron

- [ ] Delete `InboundOutboxService` (cron)
- [ ] Delete `OutboxWorkerService` (cron)
- [ ] Remove cron-related DB queries
- [ ] Update outbox row status management (CDC assumes PENDING → worker marks SUCCESS)

### Phase 3: Cleanup

- [ ] Remove `inbound_outbox.next_retry_at`, `attempts`, `status` columns (no longer needed — WAL guarantees delivery)
- [ ] Simplify outbox to: `trace_id`, `connection_id`, `schema_name`, `created_at`
- [ ] Remove `QUEUE_ENABLED=false` flag from `dev:light` (CDC works without explicit queue toggle)

---

## 11. Why Not Alternatives

### Why Not Polling Cron (Current)

Already covered in Section 1. Not event-driven, 5s latency, not horizontally scalable.

### Why Not Custom `pg-logical-replication` npm Package

| Issue | Detail |
|---|---|
| Single maintainer | ~200 GitHub stars. No company backing. |
| Protocol complexity | `pgoutput` binary WAL format changes across Postgres major versions |
| No enterprise support | If the package has a bug, you own the fix |
| Debezium alternative | 9,000+ stars, Red Hat/IBM backed, runs in production at Netflix, Airbnb, Shopify |

### Why Not Postgres LISTEN/NOTIFY

| Issue | Detail |
|---|---|
| Event loss | Notifications lost when the listener disconnects (pod restart, crash) |
| Not horizontally scalable | NOTIFY broadcasts to ALL listeners — N pods process same event N times |
| Payload size limit | 8,000 bytes max |
| No replay | Cannot recover missed notifications |

### Why Not AWS DMS

| Issue | Detail |
|---|---|
| Wrong tool | DMS is a database migration tool, not an event streaming pipeline |
| No SQS target | DMS targets: RDS, Redshift, S3, Kinesis, MSK. No SQS. |
| Cost | Per instance-hour pricing. Expensive for continuous streaming. |
| Dynamic schema support | DMS struggles with per-tenant dynamic schemas |

### Why Not PeerDB

| Issue | Detail |
|---|---|
| No HTTP sink | Cannot post to API Gateway — no HTTP delivery option |
| Kafka-focused | Primary use case is Postgres → Kafka / analytics DBs |
| Newer project | Acquired by ClickHouse 2024 — strategic direction may shift |
| Not needed | Debezium covers the use case with more maturity |

### Why Not NestJS Relay Endpoint (Instead of API Gateway)

| Issue | Detail |
|---|---|
| Single point of failure | NestJS pod crash = event loss window |
| Not serverless | Occupies pod resources even at zero load |
| Scalability bounded | Limited by pod count, not demand |
| API Gateway is better | AWS-managed, 99.99% SLA, scales to 1M requests/s, no code |

---

## Decision Summary

| Decision | Choice | Rationale |
|---|---|---|
| CDC tool | **Debezium** | Enterprise-grade, Red Hat backed, battle-tested at Netflix/Airbnb/Shopify |
| Phase 1 sink | **AWS API Gateway + SQS** | No Kafka infrastructure, runs locally via LocalStack, zero-code relay |
| Phase 2 sink | **Kafka (AWS MSK)** | Full enterprise — ordered, replayable, horizontally scalable |
| Outbox approach | **Watch outbox table, not business table** | Tiny WAL footprint, stable schema, clean separation of concerns |
| WAL publication | **Per-tenant registration on connect** | Handles dynamic schema provisioning without connector restarts |
| Migration strategy | **Parallel running → cron removal** | Zero-downtime migration, idempotent workers handle duplicates safely |