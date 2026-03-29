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

- [x] Add `prism` service to `docker-compose.yml` (port 4010 SF, 4011 QB)
- [x] Add stub `packages/pieces/salesforce/openapi.json`
- [x] Add stub `packages/pieces/quickbooks/openapi.json`
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

- [x] `apps/api/src/db/db-cli.ts` command `provision:local`
- [x] Creates all `ws_{id}` schemas for dev fixture connections
- [x] Seeds one Salesforce + one QuickBooks connection with test credentials
- [x] Add `"db:provision:local": "tsx src/db/db-cli.ts provision:local"` to `apps/api/package.json`
- Files: `apps/api/src/db/db-cli.ts`, `apps/api/package.json`
- Depends: T001

---

## Phase 0.5 — Operational Hardening

### T006 · observability: Pino + OpenObserve structured logging

> **Decision (2026-03-25):** Use [Pino](https://github.com/pinojs/pino) as the NestJS logger (structured JSON, low-overhead).
> Logs are shipped to [OpenObserve](https://github.com/openobserve/openobserve) via its HTTP ingest API using `pino-openobserve` transport
> (or a Vector/Fluentd sidecar for zero-code-change forwarding).
> OpenObserve provides both log storage and metrics pipeline — Prometheus `/metrics` endpoint (original T007) is not needed.

- [x] Install `nestjs-pino`, `pino-http` (prod); `pino-pretty` (devDep) — Vector sidecar used for OpenObserve transport (zero-code-change forwarding)
- [x] `ObservabilityModule` — `LoggerModule.forRootAsync()` with `genReqId` (uses `x-request-id` header or auto-generates UUID), `customProps` emits `{ service, traceId }` on every request log; `pino-pretty` in dev, stdout JSON in prod
- [x] L1 services migrated to `PinoLogger` with `@InjectPinoLogger`: `TenantRateLimitGuard` assigns `{ layer: 'L1', connectionId, tenantId }`; `WebhooksController` assigns `{ layer: 'L1', traceId, extReqId, durationMs }`; `WebhookSignatureGuard` assigns structured warn fields
- [x] All three spec files updated with `getLoggerToken` mock provider, `info`/`log` methods on loggerMock, and `vi.clearAllMocks()` in `beforeEach` to prevent call-count accumulation across tests
- [x] `resolveLimit` edge case tests added: fractional values → DEFAULT_LIMIT, negative values → DEFAULT_LIMIT, non-number values → DEFAULT_LIMIT, values > MAX_RATE_LIMIT (10000) → clamped to 10000
- [x] `genReqId` validates `x-request-id` against `SAFE_TRACE_ID_RE` to prevent log injection; falls back to `randomUUID()` for unsafe/absent headers
- [x] `BadRequestException` for malformed UUID uses generic message (no reflected `connectionId`)
- [x] Error log added before re-throw in `WebhooksController` catch block for L1 ingest failures
- [x] Add `LOG_LEVEL`, `OPENOBSERVE_URL`, `OPENOBSERVE_ORG`, `OPENOBSERVE_STREAM`, `OPENOBSERVE_TOKEN` to `apps/api/.env`
- [x] `pino-http` request logging wired via `LoggerModule` — logs `method`, `url`, `statusCode`, `responseTime` on every request
- [x] Vector sidecar added to `docker-compose.yml` (`timberio/vector:0.43.0-alpine`) — reads Docker container stdout, parses JSON, ships to OpenObserve HTTP ingest; config in `vector/vector.toml`
- [x] `main.ts`: `bufferLogs: true` + `app.useLogger(app.get(Logger))` — pino active from first module log
- Files: `apps/api/src/modules/observability/observability.module.ts`, `apps/api/src/main.ts`, `apps/api/src/app/app.module.ts`, `apps/api/src/guards/tenant-rate-limit.guard.ts`, `apps/api/src/modules/webhooks/webhooks.controller.ts`, `apps/api/src/modules/webhooks/webhook-signature.guard.ts`, `docker-compose.yml`, `vector/vector.toml`, `apps/api/.env`
- Depends: —

### T007 · observability: OpenObserve dashboards + alerting

- [ ] Pipeline health dashboard (L1→L6 throughput, error rates, queue depths)
- [ ] Token refresh metrics panel (`token_refresh_total`, `token_refresh_error_total`)
- [ ] Alert rules: `delivery_failure_total` spike, queue depth threshold, L1 ingest error rate
- [ ] SQS queue depth metric forwarded to OpenObserve (`sqs_queue_depth`, `pipeline_layer_duration_ms`)
- Depends: T006

### T008 · api: `ShutdownService` — graceful SIGTERM drain

- [x] `apps/api/src/core/shutdown.service.ts`
- [x] Registers `SIGTERM` + `SIGINT` handlers that trigger combined drain sequence
- [x] Calls `app.close()` which triggers OnModuleDestroy on all providers (including QueueService.stopConsuming())
- [x] Force-closes if 30s deadline elapses before drain completes
- [x] Unit tests for signal registration, successful drain, error path, and hard deadline
- Files: `apps/api/src/core/shutdown.service.ts`, `apps/api/src/core/shutdown.service.spec.ts`, `apps/api/src/main.ts`, `apps/api/src/app/app.module.ts`
- Depends: —

### T009 · api: `WebhookSignatureGuard` — HMAC per piece

- [x] `apps/api/src/modules/webhooks/webhook-signature.guard.ts`
- [x] `PieceWebhookConfig` interface added to `packages/connectors/src/framework/piece.ts`
- [x] Each piece registers its HMAC secret key name + header name via `webhook` field
- [x] Guard verifies signature using `timingSafeEqual`; returns `403` on mismatch
- [x] Salesforce + QuickBooks pieces register their webhook configs
- [x] Unit tests for pass-through, valid sig, missing header, invalid sig, missing env, missing connection, empty body
- Files: `apps/api/src/modules/webhooks/webhook-signature.guard.ts`, `apps/api/src/modules/webhooks/webhook-signature.guard.spec.ts`, `packages/connectors/src/framework/piece.ts`, `packages/pieces/salesforce/src/index.ts`, `packages/pieces/quickbooks/src/index.ts`
- Depends: —

### T010 · api: Idempotent L1 ingestion — catch duplicate webhook

- [x] `apps/api/src/modules/webhooks/webhooks.controller.ts` — POST /webhooks/:connectionId
- [x] `apps/api/src/modules/webhooks/webhooks.module.ts` — WebhooksModule wired into AppModule
- [x] Wrap `inbound_gateway` insert in try/catch
- [x] On `PgError code=23505`: return `202 Accepted` (not `500`)
- [x] Uses `x-webhook-id` or `x-event-id` header as `extReqId` for vendor idempotency
- [x] Unit tests for success, duplicate (23505), non-23505 error, header extraction
- Files: `apps/api/src/modules/webhooks/webhooks.controller.ts`, `apps/api/src/modules/webhooks/webhooks.controller.spec.ts`, `apps/api/src/modules/webhooks/webhooks.module.ts`
- Depends: —

### T011 · api: `TenantRateLimitGuard` — token bucket per tenant at L1

- [x] `apps/api/src/guards/tenant-rate-limit.guard.ts` — fixed-window token bucket via Redis Lua script
- [x] Redis key `ratelimit:l1:{tenantId}` — 1000 tokens/min default
- [x] Returns `429` with `Retry-After` header when bucket empty
- [x] Enterprise tier tenants: configurable higher bucket via `metadata.rateLimitPerMin`
- [x] Applied to webhook ingestion endpoint alongside WebhookSignatureGuard
- [x] Unit tests for allowed, rate-limited, Retry-After header, default limit, enterprise limit, missing connection
- Files: `apps/api/src/guards/tenant-rate-limit.guard.ts`, `apps/api/src/guards/tenant-rate-limit.guard.spec.ts`
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

### T013 · db: migrations `0008_workspaces` + `0009_workspace_name_unique_per_env`

- [x] Run `pnpm --filter api db:generate` after `workspace.ts` schema is confirmed
- [x] Review generated SQL, commit migration file
- Files: `apps/api/drizzle/0008_workspaces.sql`, `apps/api/drizzle/0009_workspace_name_unique_per_env.sql`, `apps/api/drizzle/meta/_journal.json`
- Depends: —

### T014 · api: `WorkspacesModule` — CRUD

- [x] `WorkspacesController`: `POST /workspaces`, `GET /workspaces`, `PATCH /workspaces/:id`, `DELETE /workspaces/:id`
- [x] `WorkspacesService`: create, list (scoped to `orgId`), update name/envType, soft-delete
- [x] DTOs: `CreateWorkspaceBody`, `UpdateWorkspaceBody` (validation files)
- [x] Unit tests for service
- Files: `apps/api/src/modules/workspaces/**`
- Depends: T013

### T015 · api: `WorkspaceConnectionsController` — assign connections to workspace

- [x] `POST /workspaces/:id/connections` — assign an existing connection
- [x] `DELETE /workspaces/:id/connections/:connId` — remove assignment
- [x] Validates connection belongs to same org
- [x] Validates `connection.env_type === workspace.env_type` — reject with `409` if mismatched (sandbox connection cannot be assigned to a production workspace and vice versa)
- [x] `GET /workspaces/:id/connections/available` — returns connections for the org filtered to matching `env_type`; used by the UI connection picker
- Files: `apps/api/src/modules/workspaces/workspace-connections.controller.ts`
- Depends: T014

### T016 · web: `WorkspacesPage` + `WorkspaceDetailPage` + sidebar directory

- [x] `WorkspacesPage` — list workspaces, "+ New Workspace" dialog (name + env toggle)
- [x] `WorkspaceDetailPage` — assigned connections list, "Assign Connection" button
- [x] Sidebar nav: each workspace renders as a **collapsible directory node** (folder icon + workspace name + env badge). Expanding a node reveals its stitches as child rows. Active route is highlighted. Only one workspace can be expanded at a time (accordion behaviour)
- [x] "Assign Connection" picker calls `GET /workspaces/:id/connections/available` so only env-type-matched connections appear — sandbox picker never shows production connections and vice versa
- Files: `apps/web/src/modules/workspaces/**`, `apps/web/src/components/layout/Sidebar.tsx`
- Depends: T014, T015

---

## Phase 2 — Stitches & Mapping Canvas

### T017 · db: migration `0010_stitches` (includes scheduler columns)

- [x] Run `pnpm --filter api db:generate`
- [x] Creates `integration_stitch` (with `sync_interval_minutes`, `schedule_enabled`, `last_scheduled_at`), `field_mapping`
- Files: `apps/api/drizzle/0010_stitches.sql`, `apps/api/drizzle/meta/_journal.json`
- Depends: T013

### T018 · piece-framework: Add `describeObjects` + `describeFields` interface methods

- [x] Add to `Piece` interface in `packages/connectors/framework/`
- [x] Salesforce piece: stub implementation (returns Prism response in local mode)
- [x] QuickBooks piece: stub implementation
- Files: `packages/connectors/framework/src/piece.interface.ts`, `packages/pieces/salesforce/src/**`, `packages/pieces/quickbooks/src/**`
- Depends: T002

### T019 · api: `MetadataDiscoveryService`

- [x] `GET /stitches/metadata/:connectionId/objects`
- [x] `GET /stitches/metadata/:connectionId/objects/:objectName/fields`
- [x] Calls `piece.describeObjects()` / `piece.describeFields()`
- [x] Caches in `connector_object_profiles` + Redis `meta:{connectionId}:{objectName}` (5-min TTL)
- Files: `apps/api/src/modules/stitches/metadata-discovery.service.ts`, `apps/api/src/modules/stitches/metadata.controller.ts`
- Depends: T017, T018

### T020 · api: `StitchesModule` — CRUD

- [x] `POST /stitches`, `GET /stitches?workspaceId=...`, `GET /stitches/:id`, `PATCH /stitches/:id`, `DELETE /stitches/:id`
- [x] `StitchesService`: create, list, update, archive
- [x] Validation: `CreateStitch`, `UpdateStitch` (Zod + nestjs-zod)
- [x] Unit tests
- Files: `apps/api/src/modules/stitches/stitches.controller.ts`, `apps/api/src/modules/stitches/stitches.service.ts`
- Depends: T017

### T021 · api: Schedule endpoints on `StitchesController` (stub)

- [x] `PATCH /stitches/:id/schedule` — validate body, persist `syncIntervalMinutes` / `scheduleEnabled` to `integration_stitch` via `StitchesService`
- [x] `PATCH /admin/stitches/:id/schedule` — same, no interval restrictions
- [x] `POST /stitches/:id/schedule/trigger` — stub returns `202`; full enqueue wired in T029
- [x] `UpdateScheduleBody` with `@IsIn([30,60,120,240,360,720,1440])` validation
- [x] Leave `// TODO(T029): call SchedulerService.reschedule/disable/register` comments at the call sites — `SchedulerService` does not exist yet
- Files: `apps/api/src/modules/stitches/stitches.controller.ts`, `apps/api/src/modules/stitches/update-schedule.validation.ts`
- Depends: T020
- Note: `SchedulerService` integration is completed in T029, which adds `SchedulerService` calls to these endpoints

### T022 · api: `FieldMappingsController`

- [x] `POST /stitches/:id/mappings`, `PATCH /stitches/:id/mappings`
- [x] Upserts `field_mapping` row on `(stitchId, sourceCanonical)`
- Files: `apps/api/src/modules/stitches/field-mappings.controller.ts`
- Depends: T020

### T023 · web: `StitchesPage` + `NewStitchPage` 3-step wizard

- [ ] Step 1: Pick source connection → source object (from metadata API)
- [ ] Step 2: Pick target connection → target object
- [ ] Step 3: Mapping Canvas — two-column field table, drag-to-connect, "+ Add Condition" row
- Files: `apps/web/src/modules/stitches/StitchesPage.tsx`, `apps/web/src/modules/stitches/NewStitchPage.tsx`, `apps/web/src/modules/stitches/MappingCanvas.tsx`
- Depends: T019, T022

### T024 · web: Schedule Panel on `StitchDetailPage`

- [ ] Frequency dropdown (30min / 1hr / 2hr / 4hr / 6hr / 12hr / 24hr)
- [ ] Enable / Pause toggle
- [ ] "Last synced" + "Next sync in ~X min" display (computed from `last_scheduled_at + interval`)
- [ ] "Run now" button → calls `POST /stitches/:id/schedule/trigger`
- Files: `apps/web/src/modules/stitches/StitchDetailPage.tsx`, `apps/web/src/modules/stitches/components/SchedulePanel.tsx`
- Depends: T021, T023

### T025 · web: Admin/Support schedule override page

- [ ] `/admin/stitches` — table of all stitches across all orgs with `last_scheduled_at`
- [ ] Per-row schedule edit with no interval restrictions
- [ ] Bulk interval override for all stitches in an org
- Files: `apps/web/src/modules/admin/AdminStitchesPage.tsx`
- Depends: T021

---

## Phase 3 — 6-Layer Pipeline + Scheduler Execution

### T026 · db-manager: New schema plans — REPLICA, NORMALIZE, OUTBOUND ✅ COMPLETE

- [x] Add `REPLICA_ACTIVE` plan: creates `replica_entity`, `sync_cursor`
- [x] Add `NORMALIZE_ACTIVE` plan: creates `normalized_entity`
- [x] Add `OUTBOUND_ACTIVE` plan: creates `outbound_gateway`, `sync_log`
- [x] Apply all three when a connection is activated in `TriggerExecutorService.applyPlan()` and `ConnectorsService`
- Files: `packages/dbmanager/src/plans/**`, `apps/api/src/modules/triggers/trigger-executor.service.ts`
- Depends: T005

### T027 · api: Update L1 — non-blocking webhook handler ✅ COMPLETE

- [x] After `inbound_gateway` insert, enqueue `{ traceId, connectionId }` to `Inbound_Queue`
- [x] Return `202 Accepted` without awaiting downstream
- [x] Add `WebhookSignatureGuard` to the controller (from T009)
- [x] Unit tests cover: success path, duplicate (idempotent from T010), signature failure
- Files: `apps/api/src/modules/webhooks/webhooks.controller.ts`, `apps/api/src/modules/webhooks/webhooks.controller.spec.ts`
- Depends: T003, T009, T010, T026

### T028 · piece-framework: Add `normalize` + `executeAction` + `poll` methods

- [ ] Add to `Piece` interface
- [ ] `normalize(objectType, raw)` → `{ canonicalType, data }`
- [ ] `executeAction(objectType, payload, credentials)` → `VendorResponse`
- [ ] `poll(credentials, window: PollWindow)` → `PollPage` — each record must carry `replicationKey` + `replicationKeyValue` so `CursorManagerService` can advance the High-Water Mark without knowing the connector schema; `PollPage.nextPageCursor` drives pagination
- [ ] Salesforce + QuickBooks: stub implementations
- [ ] Canonical model interfaces in `packages/connectors/framework/canonical/`
- [ ] `PollRecord`, `PollPage`, `PollWindow` interfaces defined in `packages/connectors/framework/` and re-exported from `packages/engine/` (see T047)
- Files: `packages/connectors/framework/src/piece.interface.ts`, `packages/connectors/framework/canonical/**`
- Depends: T018, T046

### T029 · api: `SchedulerModule` + `SchedulerService` (Windmill-backed)

> Spec: `docs/architecture/scheduling/scheduling.md` §3
> Note: DolphinScheduler replaced by **Windmill** as the schedule orchestrator.

- [x] `SchedulerService` wraps `WindmillClient` (T050) to manage stitch lifecycle in Windmill
- [x] `onStitchCreated(stitch)` — creates Windmill schedule (cron + enabled flag); skips if `scheduleEnabled=false`
- [x] `onStitchUpdated(stitch)` — update-first with fallback to create (avoids TOCTOU race)
- [x] `onStitchDeleted(stitchId)` — deletes Windmill schedule; no-op on 404
- [x] `triggerOnce(stitchId)` — fires a one-shot Windmill job; returns job ID
- [x] `deleteOrgSchedules(stitchIds[])` — bulk delete with `allSettled` (failures logged, not thrown)
- [x] `onModuleInit()` — calls `ensureStitchScript()` on boot; crash is logged but does not prevent startup
- [x] `executeStitch(stitchId)` — delegates to `SyncRunner.run()`; real implementation in T030
- [x] Stitch mutations wired via transactional outbox (`scheduler_outbox` table + `OutboxWorkerService`) — no direct `SchedulerService` calls from `StitchesService`
- [x] `OutboxWorkerService` — `@Cron(EVERY_10_SECONDS)`, `FOR UPDATE SKIP LOCKED` claim, exponential backoff, `failed` status after 5 attempts
- [x] Abstract `SyncRunner` + `StubSyncRunner` placeholder (real implementation in T030)
- Files: `apps/api/src/modules/scheduler/scheduler.module.ts`, `apps/api/src/modules/scheduler/scheduler.service.ts`, `apps/api/src/modules/scheduler/outbox-worker.service.ts`, `apps/api/src/modules/scheduler/sync-runner.ts`, `apps/api/src/modules/scheduler/stub-sync-runner.ts`
- Depends: T020, T021, T050

### T030 · api: `SchedulerWorker` — Windmill HTTP callback handler

> Spec: `docs/architecture/scheduling/scheduling.md` §2C, §Poll Run Sequence
> Note: Windmill replaces DolphinScheduler as the trigger.

- [x] `POST /internal/scheduler/execute-stitch` — receives `{ stitchId }` from Windmill; returns `ExecuteStitchResult`
- [x] `InternalSchedulerGuard` — validates `Authorization: Bearer <WINDMILL_INTERNAL_SECRET>` using timing-safe compare; returns `401` on mismatch
- [x] `executeStitch` body validated via Zod (`ExecuteStitchBody` with UUID check)
- [x] Delegates to `SyncRunner.run(stitchId)` via `PollSyncRunner` (replaces `StubSyncRunner`)
- [x] `PollSyncRunner` — resolves piece via `PieceRegistryService`; obtains valid credentials via `TokenManagerService` (handles OAuth refresh)
- [x] Acquire Redis NX lock `lock:poll:{stitchId}:{streamName}` — TTL = `max(syncIntervalMinutes × 2 × 60 000 ms, 5 × 60 000 ms)` (milliseconds); renewed before each page via atomic Lua PEXPIRE — returns `{ status: 'skipped' }` if unavailable; aborts run if lock is stolen mid-pagination
- [x] Call `piece.describeStreams(credentials)` → `StreamDescriptor` for `stitch.sourceObject`; falls back to FULL_TABLE sentinel if not supported
- [x] Read `SyncStateDocument` from `public.sync_cursors`; detect crash-resume via `currently_syncing` + `bookmark.offset`
- [x] `CursorManagerService.calculateWindow(bookmark, catalog)` → `PollWindow`; set `currently_syncing` + write initial checkpoint before first page
- [x] Paginate `piece.poll(credentials, streamName, window, cursor)` with intermediate checkpoint every `checkpointInterval` pages
- [x] Final checkpoint → `sync_cursors` (clear `currently_syncing` + `offset`); update `integration_stitch.last_scheduled_at`
- [x] 13 unit tests: happy path, multi-page, describeStreams, fallback descriptor, lock skip, lock release on error, crash-resume, not-found errors
- Files: `apps/api/src/modules/scheduler/scheduler.controller.ts`, `apps/api/src/modules/scheduler/internal-scheduler.guard.ts`, `apps/api/src/modules/scheduler/execute-stitch.validation.ts`, `apps/api/src/modules/scheduler/poll-sync-runner.ts`, `apps/api/src/modules/scheduler/poll-sync-runner.spec.ts`, `apps/api/src/modules/scheduler/sync-runner.ts`
- Depends: T028, T029, T046, T047

### T031 · api: `ReplicaService` — L2 worker ✅ COMPLETE

- [x] Consumes `Inbound_Queue`
- [x] Resolves schema via `StorageResolverService`
- [x] `UPSERT` into `replica_entity` on `(entity_type, source_id)`, increments `version`
- [x] Updates `inbound_gateway.status` → `REPLICATED`
- [x] Writes `sync_log` row `{ layer: 'L2', status: 'SUCCESS', durationMs }`
- [x] Pushes `{ traceId }` to `Replica_Queue`
- [x] Unit tests
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
- [ ] Queries `integration_stitch` for active stitches matching `src_connection_id`
- [ ] Evaluates `syncCondition` rules in-memory (`eq`, `neq`, `gt`, `lt`, `contains`)
- [ ] Per matching stitch: hydrate payload via `field_mapping` rules
- [ ] **Writes `outbound_gateway` (status=`PENDING`) BEFORE enqueuing** — crash safety
- [ ] Pushes `{ traceId, outboundGatewayId }` to `Delivery_Queue`
- [ ] Skipped stitches: write `sync_log` row `{ status: 'SKIPPED' }`
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

## Phase 3.5 — Stateful Sync (Windmill Integration + Cursor Manager)

> Spec: `docs/architecture/scheduling/scheduling.md`

### T049 · docker-compose: Add Windmill services

> Note: DolphinScheduler replaced by **Windmill**. T049 now tracks Windmill docker-compose setup.

- [x] Add `windmill-db` postgres service (reuses existing postgres with a `windmill` database via `scripts/create-windmill-db.sh`)
- [x] Add `windmill-server` service (`ghcr.io/windmill-labs/windmill:v1.662.0`) — port 8000; depends on `windmill_init`
- [x] Add `windmill-worker` service (`ghcr.io/windmill-labs/windmill-worker`) — depends on windmill-server
- [x] Add env vars to `apps/api/.env`: `WINDMILL_BASE_URL`, `WINDMILL_WORKSPACE`, `WINDMILL_TOKEN`, `WINDMILL_INTERNAL_SECRET`, `WINDMILL_ENABLED`
- [ ] Create Windmill workspace + bootstrap `f/config/NEXIOM_API_URL` and `f/config/WINDMILL_INTERNAL_SECRET` variables
- Files: `docker-compose.yml`, `apps/api/.env`
- Depends: T001

### T050 · api: `WindmillClient` — Windmill REST API adapter

> Note: DolphinScheduler replaced by **Windmill**. Implemented as `WindmillClient`.

- [x] Abstract class `WindmillClient` with methods: `ensureStitchScript`, `createSchedule`, `updateSchedule`, `setScheduleEnabled`, `scheduleExists`, `deleteSchedule`, `triggerOnce`
- [x] `HttpWindmillClient` — concrete implementation using native `fetch`; reads `WINDMILL_BASE_URL`, `WINDMILL_WORKSPACE`, `WINDMILL_TOKEN` from `ConfigService`; `AbortSignal.timeout(10s)` on every request
- [x] `StubWindmillClient` — no-op implementation; injectable when `WINDMILL_ENABLED=false`
- [x] `intervalToCron(minutes: SyncIntervalMinutes): string` — maps all 7 `SYNC_INTERVAL_OPTIONS` to Windmill-compatible cron expressions; unit tested for all values
- [x] `ensureStitchScript()` — POST-only, treats 409 as idempotent success; deploys Deno stitch-runner script that calls `/api/internal/scheduler/execute-stitch`
- [x] `updateSchedule()` returns `boolean` — `false` on 404 so caller falls back to `createSchedule` (avoids TOCTOU)
- [x] `existsOrThrow()` helper — returns `false` only on 404, throws on all other non-OK responses (prevents auth/permission errors being silently swallowed)
- [x] Unit tests: all methods covered including idempotent 409, 404 fallback, non-404 error propagation
- Files: `apps/api/src/modules/scheduler/windmill.client.ts`, `apps/api/src/modules/scheduler/http-windmill.client.ts`, `apps/api/src/modules/scheduler/stub-windmill.client.ts`, `apps/api/src/modules/scheduler/interval-to-cron.ts`
- Depends: T049

### T046 · db: migration `sync_cursors` — control-plane Singer-style cursor table

- [x] `sync_cursors` table defined in `packages/database/src/schema/stitches.ts`: `id UUID`, `stitch_id UUID` (FK → `integration_stitch.id` ON DELETE CASCADE), `stream_name VARCHAR(200)`, `state_document JSONB` (default `{"bookmarks":{},"versions":{},"currently_syncing":null}`), `created_at`/`updated_at TIMESTAMPTZ`
- [x] Unique index on `(stitch_id, stream_name)` — keyed per stitch so two stitches sharing the same source connection maintain independent cursors
- [x] Exported from `@nexiom/database` and `apps/api/src/db/schema.ts`
- [x] Migration SQL written: `packages/database/drizzle/0004_sync_cursors.sql`; journal updated
- Files: `packages/database/src/schema/stitches.ts`, `packages/database/drizzle/0004_sync_cursors.sql`, `packages/database/drizzle/meta/_journal.json`
- Depends: T001

### T047 · package: `packages/engine/` — `CursorManagerService`

- [x] `cursor-manager.types.ts` — `StreamBookmark`, `SyncStateDocument`, `ExecuteStitchPayload`, `ExecuteStitchResult`, `StreamResult`; re-exports `ReplicationKeyType`, `StreamDescriptor`, `PollWindow`, `PollRecord`, `PollPage` from `@nexiom/connectors/framework`
- [x] `cursor-manager.service.ts` — `CursorManagerService`:
  - `calculateWindow(bookmark, catalog)` — timestamp/numeric/opaque; 5-min default safety buffer; epoch / '0' / '' on first run; FULL_TABLE returns opaque empty window
  - `trackHighWaterMark(records, currentMax, type)` — numeric max, lexicographic ISO-8601 max, opaque last-write-wins; returns `currentMax` on empty input
  - Checkpoint is the caller's responsibility
- [x] `onModuleInit()` logs safety buffer and checkpoint interval
- [x] `DEFAULT_CURSOR_CHECKPOINT_INTERVAL = 10` exported constant; configurable via `CURSOR_CHECKPOINT_INTERVAL` env var
- [x] Unit tests: 28 tests covering all key types, first-run, incremental, safety buffer, multi-page accumulation, configurable buffer
- Files: `packages/engine/src/state/cursor-manager.types.ts`, `packages/engine/src/state/cursor-manager.service.ts`, `packages/engine/src/state/cursor-manager.service.spec.ts`, `packages/engine/src/index.ts`, `packages/engine/package.json`
- Depends: T046

### T048 · api: `CursorResetEndpoint` — admin full-refresh trigger

- [x] `DELETE /admin/stitches/:id/cursor/:streamName` — deletes the `sync_cursors` row for `(stitchId, streamName)`; returns `204`; idempotent (no error if row absent); triggers full refresh on next scheduled run
- [x] Superadmin guard only (`AuthGuard` + `SystemAdminGuard`); logs the reset with operator email for audit
- [x] `GET /admin/stitches/:id/cursors` — lists all `sync_cursors` rows enriched with `ageMs`, `stale`, and `paused` flags; `scheduleEnabled=false` stitches never marked stale; column allowlist excludes `stateDocument` (may contain vendor tokens); throws `NotFoundException` if stitch missing
- [x] `streamName` validated against `/^[\w.-]{1,200}$/`; invalid values rejected with `BadRequestException`; value JSON-encoded in audit log to prevent log injection
- [x] DELETE atomically acquires the per-stream Redis lock (SET NX) before deleting to close TOCTOU race with `PollSyncRunner`; returns `409 ConflictException` if lock is held; lock released in `finally`
- [x] Lock key format centralised in `lock-keys.ts` (shared by `PollSyncRunner` and `CursorResetController`)
- [x] `staleThresholdMs` guarded for non-positive `syncIntervalMinutes` (returns `Infinity`)
- [x] Unit tests: 13 tests (atomic NX lock, lock release on DB error, ConflictException, streamName validation ×3, stale/paused/fresh/empty cursor scenarios, NotFoundException)
- Files: `cursor-reset.controller.ts`, `cursor-reset.controller.spec.ts`, `lock-keys.ts`
- Depends: T046, T029

### Enterprise-grade quality pass (all scheduler module files)

- [x] **C1** `outbox-worker.service.ts`: `MAX_OUTBOX_ATTEMPTS` changed from 5 → 6 (1 initial + 5 retries) to match documented back-off schedule "2s, 4s, 8s, 16s, 32s"; tests updated for new boundary (attempts=6 permanently fails, attempts=5 retries with 32s delay)
- [x] **C2** `outbox-worker.service.ts`: `sanitizeError()` helper — logs emit truncated (≤200 char) URL-credential-stripped error message; full raw text persisted only to DB `last_error` column for human/alerting review
- [x] **C3** `http-windmill.client.ts`: 409 on `ensureStitchScript` now reads bounded body snippet (≤1 KB) and includes it in WARN log for diagnostics; dead `requestJson` method removed (W7)
- [x] **W1** `scheduler.module.ts`: `SyncRunner` factory changed to `inject: [ConfigService, ModuleRef]`; heavy deps (DB, Redis, TokenManager, PieceRegistry, CursorManager) resolved lazily via `moduleRef.get(..., { strict: false })` only when `WINDMILL_ENABLED=true` — prevents startup failures when those providers are absent
- [x] **W2** `scheduler.controller.ts`: catch block changed from `instanceof InternalServerErrorException` to `instanceof HttpException` so `NotFoundException`, `BadRequestException`, etc. propagate as the correct 4xx status instead of being wrapped as 500; test added for `NotFoundException` propagation
- [x] **W3** `poll-sync-runner.ts`: `loadStitch()` throws `NotFoundException`, `loadConnection()` throws `NotFoundException`, `resolvePiece()` throws `BadRequestException` — these now propagate through `SchedulerController` as the correct HTTP status codes; spec updated to assert exception types
- [x] **W4** `poll-sync-runner.ts`: `credentials as unknown as Record<string,unknown>` double-cast centralised into `toCredentialsRecord()` helper
- [x] **W5** `lock-keys.ts`: `pollLockKey()` extracted to shared module; `PollSyncRunner` and `CursorResetController` both import from it
- [x] **W6** `http-windmill.client.ts`: `Content-Type: application/json` only set when request has a body (GET requests omit it)
- [x] **S1** `packages/database/src/schema/stitches.ts` + `drizzle/0014_scheduler_outbox_partial_index.sql`: composite index on `(status, next_retry_at)` upgraded to partial index on `(next_retry_at)` WHERE `status='pending'`
- [x] **S2** `stub-sync-runner.ts`: changed terminal status from `'started'` → `'succeeded'` to match real runner
- [x] **S3** `interval-to-cron.ts`: comment added explaining 6-field Quartz cron support in Windmill's Rust `cron` crate
- [x] **S4** `outbox-worker.service.ts`: log messages include structured context fields (`id=`, `action=`, `stitchId=`, `attempts=`, `nextRetryAt=`, `error=`)

---

## Phase 4 — Route Intelligence Dashboard

### T036 · api: Trace API

- [ ] `GET /stitches/:id/traces?limit=50&cursor=...` — paginated list from `sync_log`
- [ ] `GET /stitches/:id/traces/:traceId` — full trace with per-layer detail (joins `inbound_gateway`, `replica_entity`, `normalized_entity`, `outbound_gateway`)
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

- [ ] `POST /stitches/:id/mappings/suggest`
- [ ] Request: `{ sourceFields: string[], targetFields: string[] }`
- [ ] Calls Claude with field lists + existing `field_mapping` rows as few-shot examples
- [ ] Response: `{ suggestions: [{ sourceField, targetField, confidence }] }`
- Files: `apps/api/src/modules/intelligence/mapping-suggest.service.ts`
- Depends: T040

### T042 · web: "Suggest Mappings" button on Mapping Canvas

- [ ] Button calls `POST /stitches/:id/mappings/suggest`
- [ ] Renders suggestions as pending rows with confidence badge
- [ ] User clicks checkmark to accept, X to reject each suggestion
- Files: `apps/web/src/modules/stitches/MappingCanvas.tsx` (extend T023)
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
- [ ] Sidebar directory node for a sandbox workspace renders with amber accent; production with green — visually distinct at a glance without opening the node
- Files: `apps/web/src/modules/workspaces/WorkspacesPage.tsx`, `apps/web/src/modules/workspaces/components/EnvBadge.tsx`
- Depends: T016

---

## Summary

| Phase | Tasks | Key deliverable |
| --- | --- | --- |
| 0 — Infrastructure | T001–T005 | Local dev environment boots end-to-end |
| 0.5 — Hardening | T006–T012 | Production-safe observability, security, graceful ops |
| 1 — Workspaces | T013–T016 | Multi-workspace CRUD + UI |
| 2 — Stitches & Mapping Canvas | T017–T025 | Stitch + field mapping + schedule config |
| 3 — Pipeline | T026–T035 | Full L1→L6 data flow + scheduler execution |
| 3.5 — Stateful Sync | T046–T050 + T029 + T030 | Windmill orchestration + Singer-style cursor engine |
| 4 — Dashboard | T036–T039 | Trace timeline + Exception Center |
| 5 — AI Mapping | T040–T042 | Claude-powered field suggestions |
| 6 — Environments | T043–T045 | Sandbox/Production routing |
| 7 — Delivery Outbox | T051 | Delivery Outbox Resiliency (Complete) |

**Total: 51 tasks**

---

## Recommended Next Sprint (priority order)

> The `feat/trace-exception-api` branch is merged. T036 and T037 are complete.
> The following tasks are unblocked and should be tackled next.

### Immediate — unblock the pipeline (required before end-to-end testing)

1. **T032** — `NormalizationService` (L3 worker): depends on T031.

2. **T033** — `FanOutService` (L4 worker): depends on T032. Already partially implemented in `apps/worker`; needs crash-safety tests and `syncCondition` evaluation.

3. **T034** — `DeliveryService` (L5 worker): depends on T033.

4. **T035** — L6 GEM write + audit: final write-back, unblocks T038/T039 UI.

### UI unblocked now (no pipeline dependency)

1. **T038** — `RouteIntelligencePage` web UI: horizontal L1→L6 pipeline diagram, paginated trace list, expandable JSON viewer. Uses the live T036 trace API — can be built in parallel with pipeline work.

2. **T039** — `ExceptionCenterPage` web UI: exception table, retry/dismiss actions per row, bulk actions. Uses the live T037 exception API.

### Clean-up required before next feature

1. **T007** — OpenObserve dashboards + alerting: now that T036/T037 are live, pipeline health metrics (L1→L6 throughput, exception spike alerts) should be set up.

