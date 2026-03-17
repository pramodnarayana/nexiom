# FluxNex: Implementation Tasks

Each task is one commit (or one small PR). Checkboxes track completion.
`Depends:` lists task IDs that must be merged first.

---

## Phase 0 — Infrastructure Foundation

### T001 · docker-compose: Postgres, Redis, PgBouncer, LocalStack

- [x] Add `docker-compose.yml` at repo root
- Services: `postgres:16-alpine` (5432), `redis:7-alpine` (6379), `pgbouncer` (5433 → 5432), `localstack` (4566, SERVICES=sqs,kms)
- Files: `docker-compose.yml`, `pgbouncer/pgbouncer.ini`
- Depends: —

### T002 · docker-compose: Add Prism mock server + OpenAPI specs

- [ ] Add `prism` service to `docker-compose.yml` (port 4010)
- [ ] Add stub `packages/pieces/salesforce/openapi.json`
- [ ] Add stub `packages/pieces/quickbooks/openapi.json`
- Files: `docker-compose.yml`, `packages/pieces/salesforce/openapi.json`, `packages/pieces/quickbooks/openapi.json`
- Depends: T001

### T003 · module: `packages/queue/` — `QueueModule` NestJS dynamic module

- [x] `queue.constants.ts` — `QUEUE_OPTIONS` injection token
- [x] `queue.interfaces.ts` — `QueueName` enum (`Inbound_Queue`, `Replica_Queue`, `Normalized_Queue`, `Delivery_Queue` + DLQ variants), `IQueueOptions`, `IQueueService` interface with `send()`, `consume()`, `stopConsuming()`
- [x] `queue.service.ts` — `@Injectable() QueueService implements IQueueService`; `INFRA_MODE=local` → LocalStack `http://localhost:4566`; `INFRA_MODE=production` → AWS SQS; implements `stopConsuming()` for graceful shutdown
- [x] `queue.module.ts` — `QueueModule.forRootAsync(options: AsyncQueueModuleOptions): DynamicModule`; registers `QueueService` with `QUEUE_OPTIONS` factory provider; exports `QueueService`
- [x] Unit tests — mock SQS client, verify `send`/`consume`/`stopConsuming` behaviour; test `forRootAsync` wiring
- Files: `packages/queue/src/queue.constants.ts`, `packages/queue/src/queue.interfaces.ts`, `packages/queue/src/queue.service.ts`, `packages/queue/src/queue.module.ts`, `packages/queue/src/index.ts`, `packages/queue/package.json`
- Depends: T001

### T004 · module: `packages/infra-adapters/` — `EncryptionModule` NestJS dynamic module

- [x] `encryption.constants.ts` — `ENCRYPTION_SERVICE` injection token
- [x] `encryption.interface.ts` — `IEncryptionService` with `encrypt(plaintext: string): Promise<string>` and `decrypt(ciphertext: string): Promise<string>`
- [x] `local-crypto.adapter.ts` — `@Injectable() LocalCryptoAdapter` using Node.js `crypto` AES-256-GCM (dev/test only)
- [x] `aws-kms.adapter.ts` — `@Injectable() AwsKmsAdapter` using `@aws-sdk/client-kms`; key ID from `KMS_KEY_ID` env
- [x] `encryption.module.ts` — `EncryptionModule.forRootAsync(options): DynamicModule`; factory provider selects adapter via `INFRA_MODE`; exports `ENCRYPTION_SERVICE` token
- [x] Consumers inject via `@Inject(ENCRYPTION_SERVICE) private readonly encryption: IEncryptionService`
- [x] Unit tests — verify encrypt/decrypt round-trip for both adapters; test module wiring with `overrideProvider`
- Files: `packages/infra-adapters/src/encryption/**`, `packages/infra-adapters/src/index.ts`, `packages/infra-adapters/package.json`
- Depends: T001

### T005 · script: `db:provision:local`

- [ ] `apps/api/src/db/db-cli.ts` command `provision:local`
- [ ] Creates all `ws_{id}` schemas for dev fixture connections
- [ ] Seeds one Salesforce + one QuickBooks connection with test credentials
- [ ] Add `"db:provision:local": "tsx src/db/db-cli.ts provision:local"` to `apps/api/package.json`
- Files: `apps/api/src/db/db-cli.ts`, `apps/api/package.json`
- Depends: T001

---

## Phase 0.5 — Operational Hardening

### T006 · package: `packages/observability/` — Pino + OpenTelemetry

- [ ] Pino logger with `traceId`, `connectionId`, `layer`, `durationMs` fields
- [ ] OpenTelemetry SDK — `withSpan(name, fn)` helper
- [ ] Export `logger`, `tracer`, `withSpan`
- [ ] Wire into NestJS app via `LoggerModule`
- Files: `packages/observability/src/**`, `apps/api/src/app.module.ts`
- Depends: —

### T007 · api: Prometheus `/metrics` endpoint

- [ ] Add `prom-client` to `apps/api`
- [ ] Expose `/metrics` with: `sqs_queue_depth`, `pipeline_layer_duration_ms`, `token_refresh_total`, `delivery_failure_total`
- [ ] In production: scrape target for CloudWatch agent; local: raw `/metrics`
- Files: `apps/api/src/modules/observability/metrics.controller.ts`
- Depends: T006

### T008 · api: `ShutdownService` — graceful SIGTERM drain

- [ ] `apps/api/src/core/shutdown.service.ts`
- [ ] Registers `SIGTERM` + `SIGINT` handlers that trigger combined drain sequence
- [ ] Signals all BullMQ workers to stop accepting new jobs
- [ ] Calls `QueueService.stopConsuming()` to halt SQS consumer polling
- [ ] Awaits in-flight SQS messages and BullMQ jobs to drain (shared 30s timeout)
- [ ] Force-closes if 30s deadline elapses before drain completes
- [ ] Calls `app.close()` after drain (or force-close timeout)
- Files: `apps/api/src/core/shutdown.service.ts`, `apps/api/src/main.ts`
- Depends: —

### T009 · api: `WebhookSignatureGuard` — HMAC per piece

- [ ] `apps/api/src/modules/webhooks/webhook-signature.guard.ts`
- [ ] Each piece registers its HMAC secret key name + header name
- [ ] Guard verifies signature using `timingSafeEqual`; returns `403` on mismatch
- [ ] Salesforce + QuickBooks pieces register their guards
- Files: `apps/api/src/modules/webhooks/webhook-signature.guard.ts`, `packages/pieces/salesforce/src/index.ts`, `packages/pieces/quickbooks/src/index.ts`
- Depends: —

### T010 · api: Idempotent L1 ingestion — catch duplicate webhook

- [ ] Wrap `inbound_gateway` insert in try/catch
- [ ] On `PgError code=23505`: return `202 Accepted` (not `500`)
- [ ] Add unit test for duplicate delivery path
- Files: `apps/api/src/modules/webhooks/webhooks.controller.ts`, `apps/api/src/modules/webhooks/webhooks.controller.spec.ts`
- Depends: —

### T011 · api: `TenantRateLimitGuard` — token bucket per tenant at L1

- [ ] Redis key `ratelimit:l1:{tenantId}` — refill 1000 tokens/min
- [ ] Returns `429` with `Retry-After` header when bucket empty
- [ ] Enterprise tier tenants: configurable higher bucket (read from tenant record)
- [ ] Apply to webhook + poll ingestion endpoints
- Files: `apps/api/src/guards/tenant-rate-limit.guard.ts`
- Depends: T001

### T012 · api: `TenantOffboardingService` — GDPR data deletion

- [ ] Drops all `ws_{id}` schemas for the org's connections
- [ ] Hard-deletes all public-schema rows for `orgId`
- [ ] Schedules KMS key alias deletion
- [ ] Emits `tenant.offboarded` event
- [ ] `DELETE /admin/tenants/:orgId` endpoint (superadmin only)
- Files: `apps/api/src/modules/admin/tenant-offboarding.service.ts`, `apps/api/src/modules/admin/admin.controller.ts`
- Depends: T005

---

## Phase 1 — Logical Workspaces

### T013 · db: migration `0005_workspaces`

- [ ] Run `pnpm --filter api db:generate` after `workspace.ts` schema is confirmed
- [ ] Review generated SQL, commit migration file
- Files: `apps/api/drizzle/0005_workspaces.sql`, `apps/api/drizzle/meta/_journal.json`
- Depends: —

### T014 · api: `WorkspacesModule` — CRUD

- [ ] `WorkspacesController`: `POST /workspaces`, `GET /workspaces`, `PATCH /workspaces/:id`, `DELETE /workspaces/:id`
- [ ] `WorkspacesService`: create, list (scoped to `orgId`), update name/envType, soft-delete
- [ ] DTOs: `CreateWorkspaceDto`, `UpdateWorkspaceDto`
- [ ] Unit tests for service
- Files: `apps/api/src/modules/workspaces/**`
- Depends: T013

### T015 · api: `WorkspaceConnectionsController` — assign connections to workspace

- [ ] `POST /workspaces/:id/connections` — assign an existing connection
- [ ] `DELETE /workspaces/:id/connections/:connId` — remove assignment
- [ ] Validates connection belongs to same org
- Files: `apps/api/src/modules/workspaces/workspace-connections.controller.ts`
- Depends: T014

### T016 · web: `WorkspacesPage` + `WorkspaceDetailPage`

- [ ] `WorkspacesPage` — list workspaces, "+ New Workspace" dialog (name + env toggle)
- [ ] `WorkspaceDetailPage` — assigned connections list, "Assign Connection" button
- [ ] Add workspace switcher to sidebar nav
- Files: `apps/web/src/modules/workspaces/**`
- Depends: T014

---

## Phase 2 — Routes & Mapping Canvas

### T017 · db: migration `0006_routes` (includes scheduler columns)

- [ ] Run `pnpm --filter api db:generate`
- [ ] Creates `integration_route` (with `sync_interval_minutes`, `schedule_enabled`, `last_scheduled_at`), `field_mapping`
- Files: `apps/api/drizzle/0006_routes.sql`, `apps/api/drizzle/meta/_journal.json`
- Depends: T013

### T018 · piece-framework: Add `describeObjects` + `describeFields` interface methods

- [ ] Add to `Piece` interface in `packages/connectors/framework/`
- [ ] Salesforce piece: stub implementation (returns Prism response in local mode)
- [ ] QuickBooks piece: stub implementation
- Files: `packages/connectors/framework/src/piece.interface.ts`, `packages/pieces/salesforce/src/**`, `packages/pieces/quickbooks/src/**`
- Depends: T002

### T019 · api: `MetadataDiscoveryService`

- [ ] `GET /routes/metadata/:connectionId/objects`
- [ ] `GET /routes/metadata/:connectionId/objects/:objectName/fields`
- [ ] Calls `piece.describeObjects()` / `piece.describeFields()`
- [ ] Caches in `connector_object_profiles` + Redis `meta:{connectionId}:{objectName}` (5-min TTL)
- Files: `apps/api/src/modules/routes/metadata-discovery.service.ts`, `apps/api/src/modules/routes/metadata.controller.ts`
- Depends: T017, T018

### T020 · api: `RoutesModule` — CRUD

- [ ] `POST /routes`, `GET /routes?workspaceId=...`, `GET /routes/:id`, `PATCH /routes/:id`, `DELETE /routes/:id`
- [ ] `RoutesService`: create, list, update, archive
- [ ] DTOs: `CreateRouteDto`, `UpdateRouteDto`
- [ ] Unit tests
- Files: `apps/api/src/modules/routes/routes.controller.ts`, `apps/api/src/modules/routes/routes.service.ts`
- Depends: T017

### T021 · api: Schedule endpoints on `RoutesController` (stub)

- [ ] `PATCH /routes/:id/schedule` — validate body, persist `syncIntervalMinutes` / `scheduleEnabled` to `integration_route` via `RoutesService`
- [ ] `PATCH /admin/routes/:id/schedule` — same, no interval restrictions
- [ ] `POST /routes/:id/schedule/trigger` — stub returns `202`; full enqueue wired in T029
- [ ] `UpdateScheduleDto` with `@IsIn([30,60,120,240,360,720,1440])` validation
- [ ] Leave `// TODO(T029): call SchedulerService.reschedule/disable/register` comments at the call sites — `SchedulerService` does not exist yet
- Files: `apps/api/src/modules/routes/routes.controller.ts`, `apps/api/src/modules/routes/dto/update-schedule.dto.ts`
- Depends: T020
- Note: `SchedulerService` integration is completed in T029, which adds `SchedulerService` calls to these endpoints

### T022 · api: `FieldMappingsController`

- [ ] `POST /routes/:id/mappings`, `PATCH /routes/:id/mappings`
- [ ] Upserts `field_mapping` row on `(routeId, sourceCanonical)`
- Files: `apps/api/src/modules/routes/field-mappings.controller.ts`
- Depends: T020

### T023 · web: `RoutesPage` + `NewRoutePage` 3-step wizard

- [ ] Step 1: Pick source connection → source object (from metadata API)
- [ ] Step 2: Pick target connection → target object
- [ ] Step 3: Mapping Canvas — two-column field table, drag-to-connect, "+ Add Condition" row
- Files: `apps/web/src/modules/routes/RoutesPage.tsx`, `apps/web/src/modules/routes/NewRoutePage.tsx`, `apps/web/src/modules/routes/MappingCanvas.tsx`
- Depends: T019, T022

### T024 · web: Schedule Panel on `RouteDetailPage`

- [ ] Frequency dropdown (30min / 1hr / 2hr / 4hr / 6hr / 12hr / 24hr)
- [ ] Enable / Pause toggle
- [ ] "Last synced" + "Next sync in ~X min" display (computed from `last_scheduled_at + interval`)
- [ ] "Run now" button → calls `POST /routes/:id/schedule/trigger`
- Files: `apps/web/src/modules/routes/RouteDetailPage.tsx`, `apps/web/src/modules/routes/components/SchedulePanel.tsx`
- Depends: T021, T023

### T025 · web: Admin/Support schedule override page

- [ ] `/admin/routes` — table of all routes across all orgs with `last_scheduled_at`
- [ ] Per-row schedule edit with no interval restrictions
- [ ] Bulk interval override for all routes in an org
- Files: `apps/web/src/modules/admin/AdminRoutesPage.tsx`
- Depends: T021

---

## Phase 3 — 6-Layer Pipeline + Scheduler Execution

### T026 · db-manager: New schema plans — REPLICA, NORMALIZE, OUTBOUND

- [ ] Add `REPLICA_ACTIVE` plan: creates `replica_entity`, `sync_cursor`
- [ ] Add `NORMALIZE_ACTIVE` plan: creates `normalized_entity`
- [ ] Add `OUTBOUND_ACTIVE` plan: creates `outbound_gateway`, `sync_log`
- [ ] Apply all three when a connection is activated in `TriggerExecutorService.applyPlan()`
- Files: `packages/dbmanager/src/plans/**`, `apps/api/src/modules/triggers/trigger-executor.service.ts`
- Depends: T005

### T027 · api: Update L1 — non-blocking webhook handler

- [ ] After `inbound_gateway` insert, enqueue `{ traceId, connectionId }` to `Inbound_Queue`
- [ ] Return `202 Accepted` without awaiting downstream
- [ ] Add `WebhookSignatureGuard` to the controller (from T009)
- [ ] Unit tests cover: success path, duplicate (idempotent from T010), signature failure
- Files: `apps/api/src/modules/webhooks/webhooks.controller.ts`, `apps/api/src/modules/webhooks/webhooks.controller.spec.ts`
- Depends: T003, T009, T010, T026

### T028 · piece-framework: Add `normalize` + `executeAction` + `poll` methods

- [ ] Add to `Piece` interface
- [ ] `normalize(objectType, raw)` → `{ canonicalType, data }`
- [ ] `executeAction(objectType, payload, credentials)` → `VendorResponse`
- [ ] `poll(credentials, cursor)` → `{ records, nextCursor }`
- [ ] Salesforce + QuickBooks: stub implementations
- [ ] Canonical model interfaces in `packages/connectors/framework/canonical/`
- Files: `packages/connectors/framework/src/piece.interface.ts`, `packages/connectors/framework/canonical/**`
- Depends: T018

### T029 · api: `SchedulerModule` + `SchedulerService`

- [ ] BullMQ `scheduler-queue` backed by Redis
- [ ] `register(routeId, intervalMinutes)` — `queue.upsertJobScheduler(`schedule:${routeId}`, { every: ms }, { name: 'poll-route', data: { routeId } })`
- [ ] `reschedule(routeId, newInterval)` — `queue.upsertJobScheduler(...)` atomically updates interval (no remove-then-add race)
- [ ] `disable(routeId)` — `queue.removeJobScheduler(`schedule:${routeId}`)`
- [ ] `onModuleInit()` — bootstraps all `ACTIVE` + `schedule_enabled=true` routes via `upsertJobScheduler` (idempotent on restart)
- [ ] Wire into `RoutesController` schedule endpoints (T021 stubs): replace TODO comments with `SchedulerService.reschedule()`/`disable()`/`register()` calls
- Files: `apps/api/src/modules/scheduler/scheduler.module.ts`, `apps/api/src/modules/scheduler/scheduler.service.ts`
- Depends: T003, T020, T021

### T030 · api: `SchedulerWorker` — poll execution

- [ ] Consumes `poll-route` jobs from `scheduler-queue`
- [ ] Guards: check `schedule_enabled` + `status=ACTIVE` before proceeding
- [ ] Reads `sync_cursor` for high-water mark (table created by T026 `REPLICA_ACTIVE` plan)
- [ ] Calls `piece.poll(credentials, cursor)` → fan out each record into `inbound_gateway` + `Inbound_Queue`
- [ ] Advances `sync_cursor` only after DB commit
- [ ] Updates `integration_route.last_scheduled_at`
- Files: `apps/api/src/modules/scheduler/scheduler.worker.ts`
- Depends: T026, T028, T029

### T031 · api: `ReplicaService` — L2 worker

- [ ] Consumes `Inbound_Queue`
- [ ] Resolves schema via `StorageResolverService`
- [ ] `UPSERT` into `replica_entity` on `(entity_type, source_id)`, increments `version`
- [ ] Updates `inbound_gateway.status` → `REPLICATED`
- [ ] Writes `sync_log` row `{ layer: 'L2', status: 'SUCCESS', durationMs }`
- [ ] Pushes `{ traceId }` to `Replica_Queue`
- [ ] Unit tests
- Files: `apps/api/src/modules/pipeline/replica.service.ts`, `apps/api/src/modules/pipeline/replica.service.spec.ts`
- Depends: T003, T026, T006

### T032 · api: `NormalizationService` — L3 worker

- [ ] Consumes `Replica_Queue`
- [ ] Calls `piece.normalize(entityType, data)`
- [ ] Writes to `normalized_entity`
- [ ] Writes `sync_log` row `{ layer: 'L3' }`
- [ ] Pushes `{ traceId }` to `Normalized_Queue`
- [ ] Unit tests
- Files: `apps/api/src/modules/pipeline/normalization.service.ts`, `apps/api/src/modules/pipeline/normalization.service.spec.ts`
- Depends: T028, T031

### T033 · api: `FanOutService` — L4 worker (crash-safe)

- [ ] Consumes `Normalized_Queue`
- [ ] Queries `integration_route` for active routes matching `src_connection_id`
- [ ] Evaluates `syncCondition` rules in-memory (`eq`, `neq`, `gt`, `lt`, `contains`)
- [ ] Per matching route: hydrate payload via `field_mapping` rules
- [ ] **Writes `outbound_gateway` (status=`PENDING`) BEFORE enqueuing** — crash safety
- [ ] Pushes `{ traceId, outboundGatewayId }` to `Delivery_Queue`
- [ ] Skipped routes: write `sync_log` row `{ status: 'SKIPPED' }`
- [ ] Unit tests — including crash-safety (write before enqueue)
- Files: `apps/api/src/modules/pipeline/fanout.service.ts`, `apps/api/src/modules/pipeline/fanout.service.spec.ts`
- Depends: T022, T032

### T034 · api: `DeliveryService` — L5 worker

- [ ] Consumes `Delivery_Queue`
- [ ] Reads `req_payload` from `outbound_gateway` (not from queue message)
- [ ] Acquires Redis refresh lock `lock:refresh:{connectionId}` via `TokenRefreshService`
- [ ] Calls `piece.executeAction(targetObject, payload, credentials)`
- [ ] On `429`/`503`: throws `RetryableException` (returns to queue, exponential backoff)
- [ ] On `5xx` after 5 attempts: DLQ → triggers Exception Center notification
- [ ] Unit tests — token refresh, retry, DLQ paths
- Files: `apps/api/src/modules/pipeline/delivery.service.ts`, `apps/api/src/modules/pipeline/delivery.service.spec.ts`
- Depends: T028, T033

### T035 · api: L6 — GEM write + final audit in `DeliveryService`

- [ ] After successful vendor response: `SET LOCAL search_path TO ws_dest` (transaction-scoped; safe for PgBouncer)
- [ ] `UPDATE outbound_gateway SET res_payload, status_code, status='SUCCESS'`
- [ ] `INSERT INTO global_entity_map` (source vendor ID ↔ dest vendor ID)
- [ ] Write `sync_log` row `{ layer: 'L6', status: 'SUCCESS' }` — drives dashboard green checkmark
- [ ] On failure: `status='FAIL'`, write `sync_log { status: 'FAIL' }`
- [ ] Unit tests
- Files: `apps/api/src/modules/pipeline/delivery.service.ts` (extend T034)
- Depends: T034

---

## Phase 4 — Route Intelligence Dashboard

### T036 · api: Trace API

- [ ] `GET /routes/:id/traces?limit=50&cursor=...` — paginated list from `sync_log`
- [ ] `GET /routes/:id/traces/:traceId` — full trace with per-layer detail (joins `inbound_gateway`, `replica_entity`, `normalized_entity`, `outbound_gateway`)
- Files: `apps/api/src/modules/intelligence/trace.controller.ts`, `apps/api/src/modules/intelligence/trace.service.ts`
- Depends: T035

### T037 · api: Exception Center API

- [ ] `GET /exceptions?orgId=...&status=unresolved`
- [ ] `POST /exceptions/:id/retry` — re-enqueues `outboundGatewayId` to `Delivery_Queue`
- [ ] `POST /exceptions/:id/dismiss`
- [ ] `ExceptionService` reads from DLQ metadata stored in Redis/DB
- Files: `apps/api/src/modules/pipeline/exception.service.ts`, `apps/api/src/modules/intelligence/exception.controller.ts`
- Depends: T035

### T038 · web: `RouteIntelligencePage`

- [ ] Horizontal L1→L6 pipeline diagram with coloured status dots (green/amber/red)
- [ ] Paginated record list — each row shows trace summary
- [ ] Expandable row → JSON viewer per layer (payload at each stage)
- [ ] 5-second auto-refresh (or SSE if available)
- Files: `apps/web/src/modules/intelligence/RouteIntelligencePage.tsx`
- Depends: T036

### T039 · web: `ExceptionCenterPage`

- [ ] Table of DLQ items: route name, record ID, failure reason, attempt count, timestamp
- [ ] "Retry" + "Dismiss" actions per row
- [ ] Bulk retry/dismiss for support team
- Files: `apps/web/src/modules/intelligence/ExceptionCenterPage.tsx`
- Depends: T037

---

## Phase 5 — AI-Assisted Mapping

### T040 · api: MCP server endpoint

- [ ] `GET /mcp/tools` — returns tools scoped to tenant's active connections
- [ ] Only exposes e.g. `salesforce_describe` if tenant has a Salesforce connection
- [ ] Uses `@anthropic-ai/sdk`
- Files: `apps/api/src/modules/intelligence/mcp.controller.ts`
- Depends: T019

### T041 · api: `MappingSuggestService` + endpoint

- [ ] `POST /routes/:id/mappings/suggest`
- [ ] Request: `{ sourceFields: string[], targetFields: string[] }`
- [ ] Calls Claude with field lists + existing `field_mapping` rows as few-shot examples
- [ ] Response: `{ suggestions: [{ sourceField, targetField, confidence }] }`
- Files: `apps/api/src/modules/intelligence/mapping-suggest.service.ts`
- Depends: T040

### T042 · web: "Suggest Mappings" button on Mapping Canvas

- [ ] Button calls `POST /routes/:id/mappings/suggest`
- [ ] Renders suggestions as pending rows with confidence badge
- [ ] User clicks checkmark to accept, X to reject each suggestion
- Files: `apps/web/src/modules/routes/MappingCanvas.tsx` (extend T023)
- Depends: T041

---

## Phase 6 — Environment Management

### T043 · api: `StorageResolverService` — env-aware pool selection

- [ ] Reads `database_host_id` from `connection_storage_registry`
- [ ] `'aurora-prod'` → production Aurora pool; `'rds-standard'` → sandbox pool
- [ ] Updates connection provisioning to set `database_host_id` based on workspace `env_type`
- Files: `apps/api/src/modules/storage/storage-resolver.service.ts`
- Depends: T016

### T044 · api: `TokenManagerService` — sandbox URL switching

- [ ] When workspace `env_type = 'SANDBOX'`: use vendor sandbox base URLs (e.g. `test.salesforce.com`)
- [ ] When `PRODUCTION`: use standard vendor URLs
- Files: `apps/api/src/modules/connections/token-manager.service.ts`
- Depends: T016

### T045 · web: Environment toggle in workspace creation + color coding

- [ ] `NewWorkspaceDialog` — radio: `Production` (green) / `Sandbox` (amber)
- [ ] All workspace-scoped pages show a badge: amber "SANDBOX" or green "PRODUCTION"
- Files: `apps/web/src/modules/workspaces/WorkspacesPage.tsx`, `apps/web/src/modules/workspaces/components/EnvBadge.tsx`
- Depends: T016

---

## Summary

| Phase | Tasks | Key deliverable |
| --- | --- | --- |
| 0 — Infrastructure | T001–T005 | Local dev environment boots end-to-end |
| 0.5 — Hardening | T006–T012 | Production-safe observability, security, graceful ops |
| 1 — Workspaces | T013–T016 | Multi-workspace CRUD + UI |
| 2 — Routes | T017–T025 | Route + field mapping + schedule config |
| 3 — Pipeline | T026–T035 | Full L1→L6 data flow + scheduler execution |
| 4 — Dashboard | T036–T039 | Trace timeline + Exception Center |
| 5 — AI Mapping | T040–T042 | Claude-powered field suggestions |
| 6 — Environments | T043–T045 | Sandbox/Production routing |

**Total: 45 tasks**
