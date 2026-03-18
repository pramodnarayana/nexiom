# FluxNex: Implementation Plan

## 1. What's Already Built

| Capability | Status | Notes |
| --- | --- | --- |
| Identity, Auth, RBAC | ✅ Done | BetterAuth, org-scoped roles, invitations |
| Multi-instance Connections | ✅ Done | OAuth2/API-key, multi-connection per tenant per app |
| Connection Storage Registry | ✅ Done | Maps `connection_id` → schema name + host + region |
| Piece Registry (Salesforce, QuickBooks) | ✅ Done | Framework + 2 concrete pieces |
| DBManager — Schema Provisioning | ✅ Done | `NAMESPACE_ONLY`, `GATEWAY_ACTIVE` plans |
| L1 Source Gateway (inbound) | ✅ Done | `inbound_gateway` table, webhooks controller, polling cron |
| Redis DLQ + Distributed Locking | ✅ Done | Lua-script DLQ, NX+EX locks per workspace+trigger |
| Storage Resolver | ✅ Done | Resolves `connectionId` → physical schema name |
| Token Refresh Service | ✅ Done | Redis `SETNX` lock per connection, re-encrypts via KMS |
| Frontend — Connections UI | ✅ Done | `ConnectionsPage`, `ActiveConnectionsPage` |
| Frontend — Identity UI | ✅ Done | Login, Signup, Invite, Tenant, Profile pages |

---

## 2. What Needs to Be Built

Everything below is **net-new work**, ordered by dependency.

---

## 3. Implementation Phases

---

### Phase 0 — Infrastructure Foundation

**Goal:** Establish the queue backbone, adapter pattern, and local dev environment before any pipeline work begins. All subsequent phases depend on this.

#### 3.0.1 SQS Queue Infrastructure

The pipeline is a **SEDA architecture** — each layer reads from one named queue and writes to the next. Four queues are required:

| Queue | Produced by | Consumed by | Message Shape |
| --- | --- | --- | --- |
| `Inbound_Queue` | L1 Webhook/Poll handler | L2 Replica Worker | `{ traceId, connectionId }` |
| `Replica_Queue` | L2 Replica Worker | L3 Normalization Worker | `{ traceId }` |
| `Normalized_Queue` | L3 Normalization Worker | L4 Fan-Out Engine | `{ traceId }` |
| `Delivery_Queue` | L4 Fan-Out Engine | L5 Delivery Engine | `{ traceId, outboundGatewayId }` |

Each queue has a corresponding Dead Letter Queue (DLQ) activated after **5 failed attempts**.

`packages/queue/` is a NestJS dynamic module — `QueueService` is `@Injectable()` and registered via `QueueModule.forRootAsync()`, so callers use standard DI and tests can `overrideProvider(QueueService)` without any manual wiring.

```typescript
// packages/queue/src/constants.ts
export enum QueueName {
  InboundQueue        = 'inbound-queue',
  ReplicaQueue        = 'replica-queue',
  NormalizedQueue     = 'normalized-queue',
  DeliveryQueue       = 'delivery-queue',
  // Dead-letter queues — activated after 5 failed attempts
  InboundQueueDLQ     = 'inbound-queue-dlq',
  ReplicaQueueDLQ     = 'replica-queue-dlq',
  NormalizedQueueDLQ  = 'normalized-queue-dlq',
  DeliveryQueueDLQ    = 'delivery-queue-dlq',
}

// packages/queue/src/interfaces/queue-service.interface.ts
export interface IQueueService {
  send(queueName: QueueName, payload: unknown, options?: SendOptions): Promise<void>;
  consume(queueName: QueueName, handler: (payload: unknown) => Promise<void>, options?: ConsumeOptions): void;
  /** Called by ShutdownService — stops polling and awaits in-flight completions. */
  stopConsuming(): Promise<void>;
}

// packages/queue/src/queue.module.ts
@Module({})
export class QueueModule {
  static forRootAsync(options: QueueModuleAsyncOptions): DynamicModule {
    return {
      global: true,
      module: QueueModule,
      imports: options.imports ?? [],
      providers: [
        { provide: QUEUE_MODULE_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
        { provide: QUEUE_SERVICE, useClass: QueueService },
        { provide: QueueService, useExisting: QUEUE_SERVICE },
      ],
      exports: [QUEUE_SERVICE, QueueService],
    };
  }
}

// Registered in AppModule:
QueueModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    infraMode: config.get<string>('INFRA_MODE') === 'local' ? 'local' : 'production',
    endpoint: config.get<string>('SQS_ENDPOINT'),   // set to http://localhost:4566 locally
    region:   config.get<string>('AWS_REGION', 'us-east-1'),
  }),
})
```

- **Production:** `QueueService` uses `@aws-sdk/client-sqs` pointing to AWS.
- **Local:** Same client pointed at `http://localhost:4566` (LocalStack) via `INFRA_MODE=local`.

#### 3.0.2 `INFRA_MODE` Adapter Pattern

All infrastructure clients switch behaviour via a single `INFRA_MODE=local|production` env variable. Affected services:

| Service | Local | Production |
| --- | --- | --- |
| Encryption | `LocalCryptoAdapter` (Node.js `crypto`) | `AwsKmsAdapter` (`@aws-sdk/client-kms`) |
| Queue | SQS → LocalStack port `4566` | SQS → AWS |
| API Mocks | Piece HTTP calls → Prism `localhost:4010` | Piece HTTP calls → vendor URLs |

`packages/infra-adapters/` is a NestJS dynamic module — `EncryptionModule.forRootAsync()` registers the correct adapter as the `ENCRYPTION_SERVICE` provider. Consumers inject via token, never import a concrete adapter directly.

```typescript
// packages/infra-adapters/src/encryption.module.ts
@Global()
@Module({})
export class EncryptionModule {
  static forRootAsync(options: EncryptionModuleAsyncOptions): DynamicModule {
    return {
      module: EncryptionModule,
      imports: options.imports ?? [],
      providers: [
        { provide: ENCRYPTION_MODULE_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
        {
          provide: ENCRYPTION_SERVICE,
          useFactory: (opts: EncryptionModuleOptions) => {
            if (opts.mode === 'local') {
              if (!opts.encryptionKey) {
                throw new Error('EncryptionModule: encryptionKey is required when mode is "local"');
              }
              return new LocalCryptoAdapter({ encryptionKey: opts.encryptionKey });
            }
            if (opts.mode === 'kms') {
              if (!opts.kmsKeyId) {
                throw new Error('EncryptionModule: kmsKeyId is required when mode is "kms"');
              }
              return new AwsKmsAdapter({ keyId: opts.kmsKeyId, region: opts.region, endpoint: opts.kmsEndpoint });
            }
            throw new Error(`EncryptionModule: unknown mode "${(opts as { mode: string }).mode}"`);
          },
          inject: [ENCRYPTION_MODULE_OPTIONS],
        },
      ],
      exports: [ENCRYPTION_SERVICE],
    };
  }
}

// Registered in AppModule:
EncryptionModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    mode:          config.get<string>('INFRA_MODE') === 'local' ? 'local' : 'kms',
    encryptionKey: config.get<string>('ENCRYPTION_KEY'),   // required when mode = 'local'
    kmsKeyId:      config.get<string>('KMS_KEY_ID'),       // required when mode = 'kms'
    region:        config.get<string>('KMS_REGION'),
    kmsEndpoint:   config.get<string>('KMS_ENDPOINT'),     // set to http://localhost:4566 locally
  }),
})

// Consumed in any service:
constructor(@Inject(ENCRYPTION_SERVICE) private readonly encryption: IEncryptionService) {}
```

#### 3.0.3 Docker Compose & Local Stack

Create `docker-compose.yml` at the repo root:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  localstack:
    image: localstack/localstack
    ports: ["4566:4566"]
    environment:
      - SERVICES=sqs,kms

  prism:
    image: stoplight/prism:4
    ports: ["4010:4010"]
    volumes:
      - ./packages/pieces/salesforce/openapi.json:/salesforce.json
      - ./packages/pieces/quickbooks/openapi.json:/quickbooks.json
    command: mock /salesforce.json
```

#### 3.0.4 OpenAPI Specs per Piece

Add `openapi.json` to each piece package for Prism to mock:

- `packages/pieces/salesforce/openapi.json`
- `packages/pieces/quickbooks/openapi.json`

In local mode, the `TokenManagerService` returns a static fake token and piece HTTP clients resolve to `http://localhost:4010`.

#### 3.0.5 `db:provision:local` Script

New script `apps/api/src/db/db-cli.ts` command `provision:local`:

- Creates all `ws_{id}` schemas needed for dev fixtures.
- Seeds one Salesforce connection + one QuickBooks connection with test credentials.

Add to `apps/api/package.json`:

```json
"db:provision:local": "tsx src/db/db-cli.ts provision:local"
```

---

### Phase 0.5 — Operational Hardening

**Goal:** Fill the enterprise gaps before any pipeline work ships. These are pre-conditions for production readiness, not nice-to-haves.

#### 3.0.6 Structured Logging & Distributed Tracing (OpenTelemetry)

Every worker and controller must propagate a `traceId` through all 6 layers via HTTP headers and queue message payloads.

- **Pino** for structured JSON logs (`level`, `traceId`, `connectionId`, `layer`, `durationMs`).
- **OpenTelemetry SDK** — one span per layer, linked by `traceId`. Export to CloudWatch / Jaeger in local mode.
- `X-Trace-Id` header injected at L1 and forwarded in every SQS message.
- New package: `packages/observability/` — exports `logger`, `tracer`, `withSpan()` helper.

#### 3.0.7 Metrics & Alerting

Expose Prometheus-compatible metrics from each worker:

| Metric | Alert Threshold |
| --- | --- |
| `sqs_queue_depth{queue}` | > 1000 messages for > 5 min |
| `pipeline_layer_duration_ms{layer}` | p99 > 10s |
| `token_refresh_total{status}` | error rate > 5% |
| `delivery_failure_total{connection}` | > 10 in 5 min |

Add CloudWatch alarms → SNS → PagerDuty in production. In local mode, expose `/metrics` endpoint for Prometheus scrape.

#### 3.0.8 Worker Autoscaling (SQS-Depth Driven)

Each layer's ECS service scales independently based on its input queue depth:

```text
Inbound_Queue  → L2 Replica Worker   ECS service  (target: 100 msgs/task)
Replica_Queue  → L3 Normalize Worker ECS service  (target: 100 msgs/task)
Normalised_Q   → L4 Fan-Out Worker   ECS service  (target: 50  msgs/task)
Delivery_Queue → L5 Delivery Worker  ECS service  (target: 25  msgs/task)
```

Both local and production use the same SQS substrate via `QueueService` — local points at LocalStack (`INFRA_MODE=local`), production points at AWS. This ensures retry counts, visibility timeout handling, and DLQ activation after 5 failures behave identically in both environments.

- **Local concurrency:** `QueueService.consume()` polls LocalStack with a `maxConcurrent` option (e.g., `{ maxConcurrent: 5 }`) per worker process — no separate queue library needed.
- **Production scaling:** ECS Application Auto Scaling target tracking policy on `ApproximateNumberOfMessages`.

#### 3.0.9 PgBouncer (Connection Pool)

Add `pgbouncer` to `docker-compose.yml` and point all workers to it instead of Aurora directly. Transaction-mode pooling — each worker holds a connection only while executing a query, not for the lifetime of the process. Prevents hitting `max_connections` under burst load.

#### 3.0.10 Graceful Shutdown

All workers must handle `SIGTERM` cleanly:

1. Stop accepting new messages from SQS (stop polling).
2. Finish in-flight jobs (with a 30s deadline).
3. Exit 0.

Without this, ECS task replacement mid-L5-delivery leaves `outbound_gateway` rows stuck at `PENDING` with no automatic retry trigger.

Add `ShutdownService` in `apps/api/src/core/` that registers `SIGTERM` and `SIGINT` handlers, signals all workers to drain, then calls `app.close()`.

#### 3.0.11 Webhook HMAC Signature Verification

Salesforce and QuickBooks both sign webhook payloads. Without verification, the L1 endpoint is open to arbitrary data injection.

New `WebhookSignatureGuard` — registered per piece:

```typescript
// packages/pieces/salesforce/src/webhook-signature.guard.ts
@Injectable()
export class SalesforceSignatureGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const sig = req.headers['x-salesforce-signature'];
    return verifyHmac(sig, req.rawBody, process.env.SF_WEBHOOK_SECRET);
  }
}
```

#### 3.0.12 Idempotent L1 Ingestion

SQS delivers messages at-least-once. If the same webhook fires twice, the `INSERT INTO inbound_gateway` will hit the `(connection_id, ext_req_id)` unique index and throw `23505`. The handler must catch this and return `202` instead of `500`:

```typescript
try {
  await db.insert(inboundGateway).values(row);
} catch (err) {
  if (isPgError(err) && err.code === '23505') return { status: 202, body: 'duplicate, ignored' };
  throw err;
}
```

#### 3.0.13 Per-Tenant Rate Limiting at L1

Prevents a single noisy tenant from starving all other tenants' workers. Implement a **token bucket** in Redis per tenant:

- Key: `ratelimit:l1:{tenantId}` — refilled at 1000 tokens/minute.
- If bucket empty: return `429 Too Many Requests` with `Retry-After` header.
- Enterprise tier tenants get a higher bucket size (configurable in the tenant record).

New `TenantRateLimitGuard` applied to the webhook and poll ingestion endpoints.

#### 3.0.14 GDPR Tenant Offboarding

When a tenant churns or requests data deletion:

New `TenantOffboardingService`:

1. Drops all `ws_{id}` schemas for the tenant's connections (`DROP SCHEMA ws_{id} CASCADE`).
2. Revokes and schedules deletion of the tenant's KMS key alias.
3. Hard-deletes all rows in public-schema tables for the `orgId`.
4. Emits a `tenant.offboarded` event for audit.

---

### Phase 1 — Logical Workspaces

**Goal:** Admins can create named Workspaces and assign existing connections to them. This is the access-control boundary between teams.

#### 3.1 Database

Schema already written: `packages/database/src/schema/workspace.ts` (`ui_workspace`, `ui_workspace_connection`).

Generate migration: `pnpm --filter api db:generate` → `0005_workspaces`.

#### 3.2 API (`apps/api/src/modules/workspaces/`)

- `WorkspacesModule`
- `WorkspacesController` — `POST /workspaces`, `GET /workspaces`, `PATCH /workspaces/:id`, `DELETE /workspaces/:id`
- `WorkspaceConnectionsController` — `POST /workspaces/:id/connections`, `DELETE /workspaces/:id/connections/:connId`
- `WorkspacesService` — CRUD + membership checks

#### 3.3 Frontend (`apps/web/src/modules/workspaces/`)

- `WorkspacesPage` — list + create dialog
- `WorkspaceDetailPage` — shows assigned connections, "Invite Connection" button
- Add workspace switcher to the sidebar (context for all downstream pages)

---

### Phase 2 — Routes & Mapping Canvas

**Goal:** Users can define a Route (Source → Target) and draw field mappings with sync conditions.

#### 3.4 Database

Schema already written: `packages/database/src/schema/routes.ts` (`integration_route`, `field_mapping`).

`syncCondition` is stored as a JSONB array on `integration_route` — no separate table needed.

**Scheduler columns on `integration_route`** (added to schema):

| Column | Type | Default | Purpose |
| --- | --- | --- | --- |
| `sync_interval_minutes` | `integer` | `30` | How often to poll this route |
| `schedule_enabled` | `boolean` | `true` | Customer can pause schedule without deleting the route |
| `last_scheduled_at` | `timestamp` | `null` | Set by `SchedulerService` on each fire; used for monitoring |

Allowed interval values: `30, 60, 120, 240, 360, 720, 1440` minutes. Enforced at the API layer — not a DB enum so support teams can set arbitrary intervals in edge cases without a schema migration.

Generate migration: `pnpm --filter api db:generate` → `0006_routes`.

#### 3.5 Metadata Discovery Service (`apps/api/src/modules/routes/`)

`MetadataDiscoveryService` — given a `connectionId`, fetches the live object/field schema:

- Calls `piece.describeObjects()` / `piece.describeFields()` (new piece interface methods).
- Caches results in `connector_object_profiles` (already in DB) via Redis key `meta:{connectionId}:{objectName}` with 5-minute TTL.
- In local mode, calls are routed to Prism (`localhost:4010`), so no real credentials are needed.

```http
GET /routes/metadata/:connectionId/objects
GET /routes/metadata/:connectionId/objects/:objectName/fields
```

#### 3.6 API (`apps/api/src/modules/routes/`)

- `RoutesController`, `RoutesService`

```http
POST   /routes
GET    /routes?workspaceId=...
GET    /routes/:id
PATCH  /routes/:id
DELETE /routes/:id
POST   /routes/:id/mappings
PATCH  /routes/:id/mappings
POST   /routes/:id/mappings/suggest

# Scheduler management
PATCH  /routes/:id/schedule          # Customer: set interval + enabled/disabled
PATCH  /admin/routes/:id/schedule    # Support team: override interval (no tier restrictions)
POST   /routes/:id/schedule/trigger  # Customer/Support: manual on-demand sync
```

`PATCH /routes/:id/schedule` body:

```typescript
class UpdateScheduleDto {
  @IsIn([30, 60, 120, 240, 360, 720, 1440])
  intervalMinutes?: number;

  @IsBoolean()
  enabled?: boolean;
}
```

When `intervalMinutes` changes, `RoutesService` persists the new value to `integration_route` and then calls `SchedulerService.reschedule(routeId, newInterval)`, which calls `queue.upsertJobScheduler()` to atomically update the interval in Redis — no remove-then-add race.

#### 3.7 Frontend — Mapping Canvas (`apps/web/src/modules/routes/`)

- `RoutesPage` — list routes per workspace
- `NewRoutePage` — 3-step wizard:
  1. Pick Source connection → pick Source object (populated from metadata API)
  2. Pick Target connection → pick Target object
  3. Mapping Canvas: two-column table, drag-to-map fields, "+ Add Condition" row
- `RouteDetailPage` — view/edit existing route

**Schedule Panel** (on `RouteDetailPage`):

```text
┌─ Sync Schedule ─────────────────────────────────┐
│  Frequency:  [ Every 30 min ▼ ]                  │
│              30min / 1hr / 2hr / 4hr / 6hr /    │
│              12hr / 24hr                         │
│                                                  │
│  Schedule:   ● Enabled   ○ Paused                │
│                                                  │
│  Last synced: 14 minutes ago                     │
│  Next sync:   in ~16 minutes                     │
│                                                  │
│  [ Run now ]                                     │
└──────────────────────────────────────────────────┘
```

**Admin / Support Portal** (`/admin/routes`):
- Same schedule panel with no interval restrictions (can set any value including custom minutes).
- Bulk override: set all routes for an org to a specific interval.
- View `last_scheduled_at` per route in a table for triage.

---

### Phase 3 — Complete the 6-Layer Pipeline

**Goal:** Wire L2–L6 so data flows end-to-end from inbound webhook to target API call with full traceability.

The key architectural constraints from `end-to-end-tech-flow.md`:

1. **L1 is non-blocking** — returns `202 Accepted` immediately, enqueues a pointer (`{ traceId, connectionId }`). The raw JSON payload stays in the DB, never in the queue message.
2. **L4 writes `outbound_gateway` (status=`PENDING`) BEFORE enqueuing to `Delivery_Queue`** — crash safety. If the system dies between L4 and L5, the record is visible as "Pending Delivery" in the UI and can be retried.
3. **L5 reads the payload from `outbound_gateway`**, not from the queue message — prevents queue payload size limits and guarantees consistency.
4. **L6 writes to the DESTINATION silo** using `SET LOCAL search_path TO ws_dest` inside the transaction — `outbound_gateway` update goes to the destination tenant schema; the `global_entity_map` INSERT goes to `public.global_entity_map` (control plane). `SET LOCAL` ensures the search_path change is transaction-scoped and reverts automatically on commit/rollback, preventing tenant routing leaks through PgBouncer connection pools.
5. **`sync_log`** — one row written per layer transition; this is what powers the Route Intelligence dashboard "green checkmark."

#### 3.8 Sync Scheduler Service

New service: `SchedulerService` in `apps/api/src/modules/scheduler/`.

**Technology:** BullMQ Job Schedulers (v5+) backed by Redis. BullMQ stores the next-run time in Redis sorted sets — only one worker fires per interval even if multiple API instances are running. No external cron daemon needed.

Use `queue.upsertJobScheduler()` / `queue.removeJobScheduler()` — the v5 Job Schedulers API. **Do not use** `queue.add(..., { repeat })` + `queue.removeRepeatable()` — the old repeatable job API requires passing the exact same repeat options to remove a job and has a race condition between remove and re-add on reschedule.

```typescript
// apps/api/src/modules/scheduler/scheduler.service.ts
export class SchedulerService {
  async register(routeId: string, intervalMinutes: number): Promise<void> {
    // upsertJobScheduler is idempotent — safe to call on startup bootstrap
    // and on re-enable. Uses routeId as the stable scheduler key.
    await this.schedulerQueue.upsertJobScheduler(
      `schedule:${routeId}`,
      { every: intervalMinutes * 60_000 },
      { name: 'poll-route', data: { routeId } },
    );
  }

  async reschedule(routeId: string, newIntervalMinutes: number): Promise<void> {
    // upsertJobScheduler atomically updates the interval — no remove-then-add race.
    await this.schedulerQueue.upsertJobScheduler(
      `schedule:${routeId}`,
      { every: newIntervalMinutes * 60_000 },
      { name: 'poll-route', data: { routeId } },
    );
  }

  async disable(routeId: string): Promise<void> {
    await this.schedulerQueue.removeJobScheduler(`schedule:${routeId}`);
  }
}
```

**Worker (`SchedulerWorker`)** — consumes the `poll-route` job:

1. Loads route from DB — checks `schedule_enabled` and `status = 'ACTIVE'` (guard against race with pause).
2. Resolves source connection's schema via `StorageResolverService`.
3. Reads `sync_cursor` for the `(connectionId, entityType)` pair to get the high-water mark.
4. Calls `piece.poll(credentials, cursor)` → returns new/changed records since cursor.
5. For each record: inserts into `inbound_gateway` + pushes `{ traceId, connectionId }` to `Inbound_Queue` (same path as webhooks — L1 entry point).
6. Advances `sync_cursor` **only after DB commit** — guarantees at-least-once delivery on restart.
7. Updates `integration_route.last_scheduled_at = now()`.

**On-Demand Trigger** (`POST /routes/:id/schedule/trigger`):

```typescript
// Enqueues an immediate one-off job (no repeat option)
await this.schedulerQueue.add('poll-route', { routeId }, { jobId: `manual:${routeId}:${Date.now()}` });
```

**Bootstrap:** On API startup, `SchedulerService.onModuleInit()` loads all `ACTIVE` routes with `schedule_enabled = true` and calls `upsertJobScheduler()` for each — idempotent, so restarting the API never creates duplicate schedulers or loses existing ones.

**Lifecycle:**

| Event | Action |
| --- | --- |
| Route created | `register(routeId, 30)` |
| Schedule interval changed | `reschedule(routeId, newInterval)` |
| Schedule paused | `disable(routeId)` |
| Schedule resumed | `register(routeId, currentInterval)` |
| Route archived/deleted | `disable(routeId)` |

#### 3.9 DBManager — New Schema Plans

Extend `SchemaPlan` in `packages/dbmanager/`:

| Plan | Tables Created |
| --- | --- |
| `REPLICA_ACTIVE` | `replica_entity`, `sync_cursor` |
| `NORMALIZE_ACTIVE` | `normalized_entity` |
| `OUTBOUND_ACTIVE` | `outbound_gateway`, `sync_log` |

All table DDL matches `packages/database/src/schema/pipeline.ts` (already written). Apply all plans when a connection is activated inside `TriggerExecutorService.applyPlan()`.

#### 3.10 L1 — Update Webhook Handler (Non-Blocking)

Update `WebhooksController` and `PollerService`:

- After writing to `inbound_gateway`, immediately push `{ traceId, connectionId }` to `Inbound_Queue`.
- Return `202 Accepted` without waiting for downstream processing.
- Lock key pattern: `lock:trigger:{workspaceId}:{triggerName}` (already exists).

#### 3.11 L2 — Universal Replica Worker

New service: `ReplicaService` in `apps/api/src/modules/pipeline/`.

- Consumes `Inbound_Queue`.
- Resolves schema via `storageResolver.resolve(connectionId)`.
- In a transaction: `SET LOCAL search_path TO {schema}`, then `UPSERT` into `replica_entity` on `(entity_type, source_id)` — increments `version` on conflict.
- Updates `inbound_gateway.status` → `REPLICATED`.
- Writes a `sync_log` row: `{ traceId, layer: 'L2', status: 'SUCCESS', durationMs }`.
- Pushes `{ traceId }` to `Replica_Queue`.

#### 3.11 L3 — Normalization Worker

New service: `NormalizationService` in `apps/api/src/modules/pipeline/`.

- Consumes `Replica_Queue`.
- Calls `piece.normalize(entityType, data)` (new piece interface method) → returns `{ canonicalType, data }`.
- Writes to `normalized_entity`.
- Writes `sync_log` row: `{ traceId, layer: 'L3', status: 'SUCCESS', durationMs }`.
- Pushes `{ traceId }` to `Normalized_Queue`.

Canonical model interfaces live in `packages/connectors/framework/canonical/`.

#### 3.13 L4 — Fan-Out Engine (Crash-Safe)

New service: `FanOutService` in `apps/api/src/modules/pipeline/`.

- Consumes `Normalized_Queue`.
- Queries `integration_route` (public schema) for all active routes where `src_connection_id` matches.
- For each matched route: evaluates `syncCondition` rules in-memory (`eq`, `neq`, `gt`, `lt`, `contains`).
- **For each passing route:**
  1. Hydrates the target JSON payload using `field_mapping` rules.
  2. **Writes `outbound_gateway` row** (status=`PENDING`, `req_payload`=hydrated JSON) in the **destination silo** (`SET LOCAL search_path TO ws_dest`).
  3. Pushes `{ traceId, outboundGatewayId }` to `Delivery_Queue`.
- Routes that fail the condition: write `sync_log` row with `status: 'SKIPPED'`.

#### 3.14 L5 — Delivery Engine

New service: `DeliveryService` in `apps/api/src/modules/pipeline/`.

- Consumes `Delivery_Queue`.
- **Reads `req_payload` from `outbound_gateway`** (not from the queue message) — prevents payload size limits.
- Acquires Redis refresh lock `lock:refresh:{connectionId}` (existing `TokenRefreshService` pattern).
  - If token expired: one worker refreshes, others poll Redis for the new token.
  - Refreshed token encrypted via KMS (`AwsKmsAdapter` / `LocalCryptoAdapter`) and saved to `app_connection`.
- Calls `piece.executeAction(targetObject, payload, credentials)` (new piece interface method).
- On `429`/`503`: throws `RetryableException` → message returns to queue for exponential backoff.
- On `5xx` after 5 attempts: message moves to DLQ → triggers Exception Center notification.

#### 3.15 L6 — Destination Gateway & GEM

Still within `DeliveryService`, after a successful vendor response:

- In a transaction on the **destination silo** (`SET LOCAL search_path TO ws_dest`):
  1. `UPDATE outbound_gateway SET res_payload=..., status_code=..., status='SUCCESS'`.
  2. `INSERT INTO global_entity_map` linking the source vendor ID to the destination vendor ID.
- Writes `sync_log` row: `{ traceId, layer: 'L6', status: 'SUCCESS', durationMs }` — this is what drives the "Green Checkmark" on the dashboard.

On failure: `UPDATE outbound_gateway SET status='FAIL'`, write `sync_log` row with `status: 'FAIL'`.

---

### Phase 4 — Route Intelligence Dashboard

**Goal:** Users see a live trace of every record flowing L1→L6 with per-layer pass/fail and duration.

#### 3.16 Trace API

```http
GET /routes/:id/traces?limit=50&cursor=...
GET /routes/:id/traces/:traceId
```

The trace response is built by querying `sync_log` (all rows for a `traceId`) which gives the per-layer status and duration without joining across 4 tables. For the expanded view, individual layer data is fetched from `inbound_gateway`, `replica_entity`, `normalized_entity`, `outbound_gateway`.

#### 3.17 Exception Center API

```http
GET /exceptions?orgId=...&status=unresolved
POST /exceptions/:id/retry
POST /exceptions/:id/dismiss
```

DLQ messages are surfaced here. Retry re-enqueues the `outboundGatewayId` to `Delivery_Queue`.

#### 3.18 Frontend

- **`RouteIntelligencePage`** — horizontal L1→L6 pipeline diagram, coloured dots per layer (green/amber/red), paginated record list with expandable JSON viewer per layer.
- **`ExceptionCenterPage`** — table of DLQ items with retry/dismiss actions.
- Real-time updates via 5-second polling or SSE.

---

### Phase 5 — AI-Assisted Mapping

**Goal:** AI proposes field mappings based on source/target schemas and existing similar routes.

#### 3.19 MCP Server

`GET /mcp/tools` — dynamically returns tools scoped to the tenant's active connections (e.g., only expose `salesforce_describe` if the tenant has a Salesforce connection). Uses `@anthropic-ai/sdk`.

#### 3.20 Mapping Suggestion API

```http
POST /routes/:id/mappings/suggest
```

Request body: `{ sourceFields: string[], targetFields: string[] }`.

Calls Claude with: the field lists + any existing `field_mapping` rows from routes with the same source/target app pair as few-shot examples.

Response: `{ suggestions: [{ sourceField, targetField, confidence }] }`.

#### 3.21 Frontend

- "Suggest Mappings" button on the Mapping Canvas.
- Renders AI suggestions with confidence badges. User clicks to accept/reject each.

---

### Phase 6 — Environment Management

**Goal:** Each workspace is tagged `SANDBOX` or `PRODUCTION`. Infrastructure routing follows the tag.

#### 3.22 Changes

- `ui_workspace.env_type` enum already in schema (`PRODUCTION` | `SANDBOX`).
- `connection_storage_registry.database_host_id`: populate `'aurora-prod'` for production, `'rds-standard'` for sandbox.
- `StorageResolverService`: extend to select the DB connection pool based on `database_host_id`.
- `TokenManagerService`: use vendor sandbox URLs when `env_type = 'SANDBOX'`.
- Frontend: workspace creation wizard shows Environment toggle. Color-code sandbox (amber) vs production (green).

---

## 4. Piece Framework Extensions

Both Salesforce and QuickBooks pieces need these new interface methods:

```typescript
interface Piece {
  // Existing
  triggers: Record<string, Trigger>;
  actions:  Record<string, Action>;

  // Phase 2 — Metadata Discovery
  describeObjects(credentials: Credentials): Promise<ObjectDescriptor[]>;
  describeFields(credentials: Credentials, objectName: string): Promise<FieldDescriptor[]>;

  // Phase 3 — Pipeline
  normalize(objectType: string, raw: Record<string, unknown>): CanonicalRecord;
  executeAction(objectType: string, payload: unknown, credentials: Credentials): Promise<VendorResponse>;
}
```

In local mode, all HTTP calls from these methods resolve to Prism (`http://localhost:4010`), controlled by an `INFRA_MODE` check in the piece HTTP client.

---

## 5. Build Order & Dependencies

```text
Phase 0   (Infrastructure: Queue, Adapters, Docker, Prism, PgBouncer)
  └── Phase 0.5 (Operational Hardening: OTel, Metrics, Autoscaling, HMAC, Rate Limiting, Graceful Shutdown)
        └── Phase 1 (Workspaces)
              └── Phase 2 (Routes + Discovery + Scheduler DB/API/UI)
                    └── Phase 3 (6-Layer Pipeline + SchedulerService + SchedulerWorker)
                          ├── Phase 4 (Intelligence Dashboard + Exception Center)
                          └── Phase 5 (AI Mapping)
Phase 6 (Environments) ← can run in parallel with Phase 1
```

---

## 6. New Files Summary

### Infrastructure & Packages

| Path | Purpose |
| --- | --- |
| `docker-compose.yml` | Postgres, Redis, LocalStack (SQS+KMS), Prism, PgBouncer |
| `packages/queue/` | SQS wrapper with `INFRA_MODE` switching |
| `packages/infra-adapters/` | `LocalCryptoAdapter`, `AwsKmsAdapter`, SQS client factory |
| `packages/observability/` | Pino logger, OpenTelemetry tracer, `withSpan()` helper |
| `packages/pieces/salesforce/openapi.json` | OpenAPI spec for Prism mocking |
| `packages/pieces/quickbooks/openapi.json` | OpenAPI spec for Prism mocking |

### Database Schema (already created)

| Path | Purpose |
| --- | --- |
| `packages/database/src/schema/workspace.ts` | `ui_workspace`, `ui_workspace_connection` |
| `packages/database/src/schema/routes.ts` | `integration_route`, `field_mapping` |
| `packages/database/src/schema/gem.ts` | `global_entity_map` |
| `packages/database/src/schema/pipeline.ts` | Data-plane table builder (`buildTenantSchema`) |

### Backend

| Path | Purpose |
| --- | --- |
| `apps/api/src/modules/workspaces/` | Workspaces CRUD module |
| `apps/api/src/modules/routes/` | Routes CRUD + Metadata Discovery |
| `apps/api/src/core/shutdown.service.ts` | `SIGTERM` handler — drains in-flight workers before exit |
| `apps/api/src/modules/scheduler/scheduler.service.ts` | BullMQ Job Schedulers (uses `upsertJobScheduler`/`removeJobScheduler`) — fires `poll-route` per route interval |
| `apps/api/src/modules/scheduler/scheduler.worker.ts` | Consumes `poll-route`, advances `sync_cursor`, enqueues to L1 |
| `apps/api/src/modules/pipeline/replica.service.ts` | L2 — Consumes `Inbound_Queue`, upserts `replica_entity` |
| `apps/api/src/modules/pipeline/normalization.service.ts` | L3 — Consumes `Replica_Queue`, writes `normalized_entity` |
| `apps/api/src/modules/pipeline/fanout.service.ts` | L4 — Consumes `Normalized_Queue`, evaluates conditions, writes `outbound_gateway` |
| `apps/api/src/modules/pipeline/delivery.service.ts` | L5+L6 — Consumes `Delivery_Queue`, calls vendor API, writes GEM + `sync_log` |
| `apps/api/src/modules/pipeline/exception.service.ts` | DLQ handler — surfaces failed jobs to Exception Center |
| `apps/api/src/modules/intelligence/mcp.controller.ts` | MCP tool server |
| `apps/api/src/modules/intelligence/mapping-suggest.service.ts` | AI mapping suggestions via Claude |
| `packages/connectors/framework/canonical/` | Canonical model type definitions (`TMS_INVOICE` etc.) |

### Frontend

| Path | Purpose |
| --- | --- |
| `apps/web/src/modules/workspaces/` | Workspace list, detail, connection assignment |
| `apps/web/src/modules/routes/` | Route list, new route wizard, mapping canvas |
| `apps/web/src/modules/intelligence/RouteIntelligencePage.tsx` | L1→L6 trace timeline |
| `apps/web/src/modules/intelligence/ExceptionCenterPage.tsx` | DLQ items with retry/dismiss |

---

## 7. Migrations Needed

| Migration | Change |
| --- | --- |
| `0005_workspaces` | `ui_workspace`, `ui_workspace_connection` |
| `0006_routes` | `integration_route`, `field_mapping` |
| `0007_gem` | `global_entity_map` |

All generated via `pnpm --filter api db:generate` after schema files are added. Data-plane tables (`replica_entity`, `normalized_entity`, `outbound_gateway`, `sync_log`, `sync_cursor`) are provisioned by DBManager at runtime — no public-schema migration needed.

---

## 8. Local Developer Quickstart

After cloning and `pnpm install`:

```bash
docker-compose up -d            # Start Postgres, Redis, LocalStack, Prism
pnpm run db:provision:local     # Create schemas + seed dev connections
pnpm run dev                    # Start API + web in watch mode
```

Test the full pipeline locally:

```bash
curl -X POST http://localhost:4000/webhooks/salesforce \
  -H "Content-Type: application/json" \
  -d '{ "sobjectType": "rtms__Load__c", "Id": "SF-001", "Region": "US" }'
```

Then open `http://localhost:3000` → Route Intelligence → see the L1→L6 green trace.
