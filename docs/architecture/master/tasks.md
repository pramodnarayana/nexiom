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

### T004 · module: `packages/infra/` — `EncryptionModule` NestJS dynamic module

- [x] `encryption.constants.ts` — `ENCRYPTION_SERVICE` injection token
- [x] `encryption.interface.ts` — `IEncryptionService` with `encrypt(plaintext: string): Promise<string>` and `decrypt(ciphertext: string): Promise<string>`
- [x] `local-crypto.adapter.ts` — `@Injectable() LocalCryptoAdapter` using Node.js `crypto` AES-256-GCM (dev/test only)
- [x] `aws-kms.adapter.ts` — `@Injectable() AwsKmsAdapter` using `@aws-sdk/client-kms`; key ID from `KMS_KEY_ID` env
- [x] `encryption.module.ts` — `EncryptionModule.forRootAsync(options): DynamicModule`; factory provider selects adapter via `INFRA_MODE`; exports `ENCRYPTION_SERVICE` token
- [x] Consumers inject via `@Inject(ENCRYPTION_SERVICE) private readonly encryption: IEncryptionService`
- [x] Unit tests — verify encrypt/decrypt round-trip for both adapters; test module wiring with `overrideProvider`
- Files: `packages/infra/src/encryption/**`, `packages/infra/src/index.ts`, `packages/infra/package.json`
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
- [x] ~`WorkspaceDetailPage` — assigned connections list, "Assign Connection" button~ (Removed: obsolete workspace-level connection assignment logic)
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

### T022B · engine: `MappingEngine` — Standard Execution Engine

> Spec: `docs/architecture/sync_strategy/sync_strategy.md` §3B, §3.5
> Location: `engine/application/mapping/` (Application Layer of the Sync Engine)

First net-new code written directly inside `engine/application/`. Takes the
Mapping Config + Stitch Config + Canonical Composite JSON and produces the
target JSON payload. Uses path utilities from `engine/platform/path-utils/`.

- [x] **`mapping.types.ts`** — shared types
  - `MappingRule: { srcPath: string; destPath: string; formula?: FormulaRef }`
  - `FormulaRef: { name: string; args: Record<string, unknown> }`
  - `StitchConfig: Record<string, unknown>` (typed JSONB from `integration_stitch.config`)
  - `MappingInput: { compositeJson, mappingRules, stitchConfig }`
  - `MappingResult: { payload: Record<string, unknown>; warnings: string[] }`

- [x] **`jsonata-extensions.ts`** — IBM JSONata used for platform-verified transform functions
  - Standard transformations offloaded to JSONata expressions instead of custom formula map.
  - Custom functions injected via JSONata bindings if necessary.
  - Unit tested for formula error paths.

- [x] **`config-applicator.ts`** — applies `StitchConfig` behavioral flags to the built payload
  - Called after field mapping; receives the assembled payload + stitchConfig
  - Example: if `stitchConfig.useTaxCode === true` → sets `payload.TxnTaxDetail = { TaxCode: stitchConfig.taxCodeDefault }`
  - Example: if `stitchConfig.currencyOverride` → overrides `payload.CurrencyRef.value`
  - Applicator rules defined per piece via `piece.describeConfig()`

- [x] **`mapping-engine.ts`** — main entry point: `MappingEngine` class
  - `build(input: MappingInput): MappingResult`
  - Step 1: Iterates `mappingRules`; for each rule: evaluates JSONata `formula` if present against `compositeJson` → `setNestedValue(payload, destPath, value)`
  - Step 2: `configApplicator.apply(payload, stitchConfig)` — layers behavioral flags
  - Step 3: Returns `{ payload, warnings }` — warnings for unmapped fields, missing formula args
  - `FanOutService` (`apps/worker`) updated to call `MappingEngine.build()` in place of legacy `hydratePayload()`

- [x] **`engine/application/mapping/package.json`** — `@nexiom/mapping`, exports `MappingEngine`, types

- [x] **Unit tests** (`mapping-engine.spec.ts`)
  - Field mapping: src path resolved, dest path set
  - Formula applied: testing JSONata expressions
  - Config applicator: `useTaxCode=true` adds TxnTaxDetail; `false` leaves payload unchanged
  - Missing src path: warning emitted, field skipped
  - Unsafe path segment: throws (proto-pollution guard)

- Files:
  - `engine/application/mapping/src/mapping.types.ts`
  - `engine/application/mapping/src/jsonata-extensions.ts`
  - `engine/application/mapping/src/config-applicator.ts`
  - `engine/application/mapping/src/mapping-engine.ts`
  - `engine/application/mapping/src/mapping-engine.spec.ts`
  - `engine/application/mapping/package.json`
  - `apps/worker/src/modules/pipeline/fanout.service.ts` (updated import)
- Depends: T022, T055-phase-1

### T023 · web: `StitchesPage` + `NewStitchPage` — Policy-Aware 3-Step Wizard

> Spec: `docs/architecture/sync_strategy/sync_strategy.md` §1, §4

- [x] **`StitchesPage`** — list all stitches for the workspace; "+ New Stitch" CTA
- [x] **Step 1 — Source Selection (Policy-Driven)**
  - Query `GET /workspaces/:id/connections/available` — connections are auto-populated by the Policy Engine (RBAC/ABAC); no manual picker needed
  - User selects a Source Connection from the auto-populated list, then selects a Source Object (calls `GET /stitches/metadata/:connectionId/objects`)
  - On Source Object selection, call the **Dependency Discovery Service** (`GET /stitches/metadata/:connectionId/objects/:objectName/related`) to retrieve the "Business Universe" (parent 1:1 and child 1:N related objects)
  - Render discovered related objects as a **pre-checked, immutable dependency list** — user sees them but cannot uncheck them
- [x] **Step 2 — Target Selection (Policy-Driven)**
  - Target Connection auto-populated by Policy Engine (same `available` endpoint, filtered to workspace env_type)
  - User selects Target Connection, then Target Object
- [x] **Step 3 — No-Code Mapping Canvas + Configuration**

  **Tab A — Field Mapping:**
  - **Source panel:** fields displayed as **human-readable labels** grouped by entity (e.g., `Load → Total Weight`, `Account → Tax ID`, `Stop → Delivery Date`) — sourced from `describeFields` display names, never raw JSON keys
  - **Target panel:** flat list of target object field labels (e.g., `Invoice → Total Amount`, `Invoice → Vendor Tax ID`)
  - Each target field has a **Drop Zone** — user drags a source field label into it; no JSON path is ever shown or typed
  - Internally the platform maps the selected label to its JSON path (`data.Account.TaxId`) and stores it in the Mapping Config — fully transparent to the user
  - **Formula Library** dropdown available per mapping row: platform-verified transform functions applied via simple inputs — never free-form code
  - `"+ Add Condition"` row for `syncCondition` rules — field comparison dropdowns only

  **Tab B — Configuration:**
  - Renders the stitch's **behavioral options** returned by `piece.describeConfig()`
  - Each option is a **toggle** (boolean), **dropdown** (enumerated), or **text input** (default value) — never free-form expressions
  - Example: `Use Tax Code` (toggle) + `Default Tax Code` (text), `Currency Override` (dropdown), `Duplicate Strategy` (dropdown)
  - Saved as `config` JSONB on `integration_stitch` — read by the Standard Execution Engine at runtime alongside the Mapping Config
  - Options the customer does not configure use piece-defined defaults

  On completion: calls `POST /stitches` (with `config`), then `POST /stitches/:id/mappings`

- Files:
  - `apps/web/src/modules/stitches/StitchesPage.tsx`
  - `apps/web/src/modules/stitches/NewStitchPage.tsx`
  - `apps/web/src/modules/stitches/MappingCanvas.tsx`
  - `apps/web/src/modules/stitches/components/DependencyList.tsx`
  - `apps/web/src/modules/stitches/components/FormulaLibrary.tsx`
  - `apps/web/src/modules/stitches/components/StitchConfigPanel.tsx`
- Depends: T019, T022, T022B

### T024 · web: `StitchDetailPage` — Schedule Panel + Composite Context

> Spec: `docs/architecture/sync_strategy/sync_strategy.md` §3A, §3.5

- [x] **Schedule Panel** (`SchedulePanel.tsx`)
  - Frequency dropdown (30min / 1hr / 2hr / 4hr / 6hr / 12hr / 24hr)
  - Enable / Pause toggle (calls `PATCH /stitches/:id/schedule`)
  - "Last synced" + "Next sync in ~X min" display (computed from `last_scheduled_at + syncIntervalMinutes`)
  - "Run now" button → calls `POST /stitches/:id/schedule/trigger` → shows job-dispatched toast
- [x] **Configuration Panel** (`StitchConfigPanel.tsx`)
  - Editable view of the stitch's behavioral flags (same controls as T023 Tab B — toggles, dropdowns, text inputs)
  - Calls `PATCH /stitches/:id` with updated `config` on save
  - Allows post-creation edits without re-running the full wizard (e.g., customer decides to enable Tax Code after go-live)
- [x] **Related Objects Panel** (`RelatedObjectsPanel.tsx`)
  - Read-only list of the auto-enrolled related objects from Step 1 (Dependency Discovery)
  - Displays `entity_type`, `source_id` pattern, and sync status — makes it clear what will be included in the Composite JSON at L4
- [x] **Mapping Summary** — compact read-only view of the field mappings created in T023, displayed as `Source Entity → Field Label` → formula (if any) → `Target Field Label`; never shows raw JSON paths
- Files:
  - `apps/web/src/modules/stitches/StitchDetailPage.tsx`
  - `apps/web/src/modules/stitches/components/SchedulePanel.tsx`
  - `apps/web/src/modules/stitches/components/RelatedObjectsPanel.tsx`
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

### T028 · piece-framework: Add `normalize` + `executeAction` + `poll` methods ✅ COMPLETE

- [x] Add to `Piece` interface (`normalize`, `executeAction`, `VendorResponse`, `NormalizedRecord`, `CanonicalType`)
- [x] `normalize(objectType, raw)` → `NormalizedRecord | null` — returns null when piece has no canonical mapping; L3 defaults to `'RAW'`
- [x] `executeAction(objectType, payload, credentials)` → `VendorResponse` — real HTTP implementation with 15s AbortSignal timeout
- [x] `poll(credentials, window: PollWindow)` → `PollPage` — already defined in T030/T047
- [x] `RetryableException` class added to `packages/connectors/src/framework/retryable-exception.ts` — thrown by piece for 429/502/503/504 to trigger RETRY path
- [x] Salesforce: real `executeAction` (POST to `/services/data/v59.0/sobjects/:type`); `normalize` returns null (RAW pass-through)
- [x] QuickBooks: real `executeAction` (POST to `/v3/company/:realmId/:type`); `normalize` returns null
- [x] `CanonicalType` union defined in `packages/connectors/src/framework/canonical/index.ts`
- Files: `packages/connectors/src/framework/retryable-exception.ts`, `packages/connectors/src/framework/index.ts`, `packages/pieces/salesforce/src/index.ts`, `packages/pieces/quickbooks/src/index.ts`
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

### T032 · api: `NormalizationService` — L3 worker ✅ COMPLETE

- [x] Consumes `Replica_Queue` via `QueueService.consume`
- [x] Poison-pill guard — drops messages missing `traceId`/`connectionId` (ACK, no rethrow)
- [x] Typed `appConnections` Drizzle query to resolve `appName` (no raw SQL)
- [x] Calls `piece.normalize(entityType, data)` → stores `NormalizedRecord`; falls back to `canonicalType='RAW'` when null
- [x] Idempotent insert into `normalized_entity` (`onConflictDoNothing` on `replicaId`)
- [x] Idempotent insert into `normalized_outbox` (`onConflictDoNothing` on `(traceId, connectionId)`)
- [x] Writes `sync_log { layer: 'L3', status: 'SUCCESS' }` with `onConflictDoNothing` on `(traceId, layer, status)`
- [x] Error path: writes `sync_log { status: 'FAIL' }`, sets `inbound_gateway.status='FAIL'`, rethrows
- [x] `sanitizeError()` used for all `lastError` and log fields (credential-safe)
- [x] Unit tests: 9 tests covering happy path, invalid message, normalize→RAW, normalize throws, connection not found, piece not registered, replica not found
- Files: `apps/worker/src/modules/pipeline/normalization.service.ts`, `apps/worker/src/modules/pipeline/normalization.service.spec.ts`
- Depends: T028, T031

### T033 · api: `FanOutService` — L4 worker (crash-safe) ✅ COMPLETE

- [x] Consumes `Normalized_Queue` via `QueueService.consume`
- [x] Poison-pill guard — drops messages missing `traceId`/`connectionId` (ACK, no rethrow)
- [x] Queries `integration_stitch` for active stitches on `src_connection_id`
- [x] Evaluates `syncCondition` rules in-memory via `evaluateConditions()` from `@nexiom/engine`
- [x] Per matching stitch: hydrate payload via `field_mapping` rules with `hydratePayload()`
- [x] **Writes `outbound_gateway` (PENDING) BEFORE `delivery_outbox`** — crash-safe ordering with `onConflictDoUpdate` for idempotency
- [x] `delivery_outbox.payload` includes: `srcVendorId`, `canonicalType`, `srcAppName`, `srcTenantId` — all fields needed by DeliveryService (L5) to write the Global Entity Map without extra joins
- [x] Fan-out uses `processInChunks(stitches, 5, ...)` — caps concurrency at 5 to prevent event-loop blockage on high-cardinality fan-outs
- [x] `processSingleStitch()` private method for clean separation
- [x] `writeSyncLog()` helper — `onConflictDoNothing` on `(traceId, routeId, layer, status)`
- [x] Skipped stitches write `sync_log { status: 'SKIPPED' }`; per-stitch errors write `FAIL` and continue to next stitch
- [x] Typed `appConnections` Drizzle query (no raw SQL)
- [x] `sanitizeError()` on all error log fields
- Files: `apps/worker/src/modules/pipeline/fanout.service.ts`, `apps/worker/src/modules/pipeline/fanout.service.spec.ts`
- Depends: T022, T032

### T034 · api: `DeliveryService` — L5 worker ✅ COMPLETE

- [x] Consumes `Delivery_Queue` via `QueueService.consume`
- [x] Poison-pill guard — drops messages missing `traceId`, `connectionId`, `targetConnectionId`, `routeId`, `outboundGatewayId`
- [x] Reads `reqPayload` + `attemptCount` from `outbound_gateway` atomically (TX-1)
- [x] **MAX_ATTEMPTS guard** — if `attemptCount >= 5`, marks FAIL immediately without calling the piece
- [x] Resolves credentials via `TokenManagerService.getValidCredentials()`
- [x] Typed `appConnections` Drizzle query for `targetAppName` + `targetTenantId` (no raw SQL)
- [x] Atomic claim TX-2: transitions `PENDING`/`RETRY` → `PROCESSING` via conditional UPDATE; skips if already claimed
- [x] Calls `piece.executeAction(targetObject, reqPayload, credentials)`
- [x] **Retry classification**: `RetryableException` → RETRY; HTTP 429/502/503/504 → RETRY; all other non-2xx → FAIL
- [x] `sanitizeError()` on all error log fields and DB `resPayload`
- [x] Unit tests: 16 tests — happy path, format error, statusCode extraction, invalid message (ACK), 429→RETRY, 503→RETRY, RetryableException→RETRY, 422→FAIL, MAX_ATTEMPTS→FAIL without executeAction call
- Files: `apps/worker/src/modules/pipeline/delivery.service.ts`, `apps/worker/src/modules/pipeline/delivery.service.spec.ts`
- Depends: T028, T033

### T035 · api: L6 — GEM write + final audit in `DeliveryService` ✅ COMPLETE

- [x] `writeL6Result()` private method — single atomic TX-3 covering all L6 writes
- [x] `UPDATE outbound_gateway SET resPayload, statusCode, status` (SUCCESS / FAIL / RETRY)
- [x] **Global Entity Map upsert** on SUCCESS with both `srcVendorId` and `destVendorId`: `INSERT INTO global_entity_map ... ON CONFLICT DO UPDATE SET destEntityId, lastSyncedAt=NOW()` — idempotent on re-delivery
- [x] `destVendorId` extracted from vendor response body via `extractDestVendorId()` (checks `id`, `Id`, `result.id`, `data.id`)
- [x] `srcVendorId` threaded from `replica_entity.sourceId` via L4 `deliveryOutbox.payload` — no cross-schema join at L5/L6
- [x] GEM populated with `sourceAppId=connectionId`, `destAppId=targetConnectionId` (real FK UUIDs, not placeholders)
- [x] `orgId` fields populated from `tenantId` retrieved from typed `appConnections` query
- [x] GEM write skipped gracefully when `srcVendorId` or `destVendorId` is absent (partial sync still succeeds)
- [x] `sync_log { layer: 'L6', status }` written with `onConflictDoNothing` on `(traceId, routeId, layer, status)`
- [x] On unexpected error: compensating TX marks `outbound_gateway` FAIL and writes FAIL `sync_log`
- Files: `apps/worker/src/modules/pipeline/delivery.service.ts` (extends T034)
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

- [x] `GET /stitches/:id/traces?limit=50&cursor=...` — paginated list from `sync_log`
- [x] `GET /stitches/:id/traces/:traceId` — full trace with per-layer detail (joins `inbound_gateway`, `replica_entity`, `normalized_entity`, `outbound_gateway`)
- Files: `apps/api/src/modules/intelligence/trace.controller.ts`, `apps/api/src/modules/intelligence/trace.service.ts`
- Depends: T035

### T037 · api: Exception Center API

- [x] `GET /exceptions?orgId=...&status=unresolved`
- [x] `POST /exceptions/:id/retry` — re-enqueues `outboundGatewayId` to `Delivery_Queue`
- [x] `POST /exceptions/:id/dismiss`
- [x] `ExceptionService` reads from DLQ metadata stored in Redis/DB
- Files: `apps/api/src/modules/pipeline/exception.service.ts`, `apps/api/src/modules/intelligence/exception.controller.ts`
- Depends: T035

### T038 · web: `PipelineTracePage` (formerly `RouteIntelligencePage`)

- [x] Horizontal L1→L6 pipeline diagram with coloured status dots (green/amber/red)
- [x] Paginated record list — each row shows trace summary
- [x] Expandable row → JSON viewer per layer (payload at each stage)
- [x] 5-second auto-refresh (or SSE if available)
- Files: `apps/web/src/modules/trace/pages/PipelineTracePage.tsx`
- Depends: T036

### T039 · web: `ExceptionCenterPage`

- [x] Table of DLQ items: route name, record ID, failure reason, attempt count, timestamp
- [x] "Retry" + "Dismiss" actions per row
- [ ] Bulk retry/dismiss for support team (deferred)
- Files: `apps/web/src/modules/exceptions/pages/ExceptionCenterPage.tsx`
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

## Phase 7 — Delivery Outbox Resiliency

### T051 · api: Delivery Outbox Pattern

- [x] Add `delivery_outbox` Drizzle schema mappings and PostgreSQL CHECK constraint enums.
- [x] Refactor `ConnectorsService` to use PROVISIONING before database completion.
- [x] Implement robust `ReplicaOutboxService` atomic locks guaranteeing L2 -> L3 transport logic.
- [x] Strip untyped `durationMs` hacks and substitute row-level skip locks and `replica_outbox` commits in L2 worker.
- Files: `packages/database/src/schema/pipeline.ts`, `apps/api/src/modules/pipeline/replica.service.ts`, `apps/api/src/modules/pipeline/replica-outbox.service.ts`

### T052 · api: Hardened L3 & L4 Pipeline Outbox ✅ COMPLETE

- [x] `normalized_outbox` Drizzle schema in `packages/database/src/schema/pipeline.ts` with unique index on `(traceId, connectionId)`
- [x] `NormalizationService` (L3): atomic transactional outbox — inserts `normalized_entity` then `normalized_outbox` in single TX; `onConflictDoNothing` on both for idempotency
- [x] `FanOutService` (L4): reads from `normalized_outbox` queue and writes to `delivery_outbox` — crash-safe ordering (outbound_gateway BEFORE delivery_outbox)
- [x] `NormalizedOutboxWorker` — `FOR UPDATE SKIP LOCKED` batch claim, exponential backoff, `MAX_ATTEMPTS` guard; publishes to `Normalized_Queue` and transitions rows `PENDING → PROCESSING → COMPLETED`
- [x] `DeliveryOutboxWorker` — same pattern for L4→L5 handoff via `Delivery_Queue`
- [x] All sync_log inserts use `onConflictDoNothing` on `(traceId, layer, status)` unique constraint `uq_sync_log_trace_layer_status`
- [x] `sanitizeError()` used throughout for credential-safe error persistence
- Files: `packages/database/src/schema/pipeline.ts`, `apps/worker/src/modules/pipeline/normalization.service.ts`, `apps/worker/src/modules/pipeline/fanout.service.ts`, `apps/worker/src/modules/pipeline/normalized-outbox.worker.ts`, `apps/worker/src/modules/pipeline/delivery-outbox.worker.ts`
- Depends: T051

---

## Phase 8 — Fleet Sharding

### T053 · engine: Custom Logic Extension Hook (`isolated-vm`)

- [ ] Add `isolated-vm` dependency to `@nexiom/engine`.
- [ ] Implement `LogicResolverService` that checks the local shard directory for a tenant's custom script before falling back to generic pipeline logic.
- [ ] Run custom scripts within a secure `ivm.Isolate` context with strict memory buffers and timeouts (e.g., 128MB, 1s timeout) to prevent platform DoS.
- Files: `packages/engine/src/executor/logic-resolver.ts`
- Depends: T035

### T054 · worker: GitOps Shard Synchronization

- [ ] Implement a worker cron service that pulls/fetches mapped Git Shard repositories (e.g. `fluxnex-shard-001`) onto the local disk every 5 minutes.
- [ ] Implement an in-memory or Redis-backed cache invalidation when a shard is updated so the `LogicResolverService` uses the latest custom logic from customers.
- Files: `apps/worker/src/modules/gitops/shard-sync.service.ts`
- Depends: T053

---

## Summary

| Phase | Tasks | Completed | Key deliverable |
| --- | --- | --- | --- |
| 0 — Infrastructure | T001–T005 | ✅ All | Local dev environment boots end-to-end |
| 0.5 — Hardening | T006–T012 | ✅ T006,T008–T011 · ⬜ T007,T012 | Production-safe observability, security, graceful ops |
| 1 — Workspaces | T013–T016 | ✅ All | Multi-workspace CRUD + UI |
| 2 — Stitches & Mapping Canvas | T017–T025 | ✅ T017–T024 · ⬜ T025 | Stitch + field mapping + schedule config |
| 3 — Pipeline | T026–T035 | ✅ All | Full L1→L6 data flow + scheduler execution |
| 3.5 — Stateful Sync | T046–T050 + T029 + T030 | ✅ All | Windmill orchestration + Singer-style cursor engine |
| 4 — Dashboard | T036–T039 | ✅ All | Trace timeline + Exception Center |
| 5 — AI Mapping | T040–T042 | ⬜ All | Claude-powered field suggestions |
| 6 — Environments | T043–T045 | ⬜ All | Sandbox/Production routing |
| 7 — Delivery Outbox | T051–T052 | ✅ All | Delivery Outbox Resiliency |
| 8 — Fleet Sharding | T053–T054 | ⬜ All | Sandboxed execution of customer logic |

> Total: 54 tasks · Completed: ~40 · Remaining: ~14

---
---

## Phase 9 — Monorepo Architecture Restructure

> Spec: `docs/architecture/sync_strategy/sync_strategy.md` §0
>
> **Goal:** Establish a clear top-level directory boundary between the
> **Nexiom Sync Engine** (core business / IP) and **Infrastructure packages**
> (commodity plumbing). All net-new engine code must go in `engine/` from
> this point forward. Existing misplaced packages migrate incrementally.

### T055 · infra: Monorepo Directory Restructure — `engine/` + `packages/`

- [x] **Phase 0 — Scaffold `engine/` directory** (prerequisite for T022B)
  - Create `engine/platform/` and `engine/application/` directories
  - Add root `engine/README.md` documenting the Platform vs Application boundary
  - Add `engine/application/mapping/` scaffold (empty package) for T022B
  - Update root `pnpm-workspace.yaml` to include `engine/*/*` glob
  - Update root `tsconfig.json` / `turbo.json` path aliases
  - **No existing code moves in this phase** — zero disruption

- [x] **Phase 1 — Migrate engine platform primitives**
  - Move `packages/engine/` → `engine/platform/core/` (`@nexiom/engine` package name unchanged)
  - `CursorManagerService`, `StorageResolver`, `evaluator`, `hydrator`, `path-utils` — all stay, just relocate
  - Update all import paths in `apps/api`, `apps/worker`
  - All tests must pass before merge

- [x] **Phase 2 — Migrate piece framework**
  - Move `packages/piece-framework/` → `engine/platform/piece-framework/` (`@nexiom/piece-framework` unchanged)
  - Generic `Piece`, `Action`, `Trigger`, `Poll` contracts only — no vendor code

- [x] **Phase 3 — Migrate application packages**
  - Move `packages/connectors/` → `engine/application/connectors/` (`@nexiom/connectors` unchanged)
  - Move `packages/pieces/` → `engine/application/pieces/` (`@nexiom/pieces` unchanged)
  - Salesforce + QuickBooks implementations move with their tests

- [x] **Phase 4 — Verify `packages/` contains only infrastructure**
  - Remaining in `packages/`: `queue`, `database`, `cache`, `infra-adapters`, `auth`, `identity`, `dbmanager`, `eslint-config`
  - Add `packages/README.md`: "Infrastructure packages — commodity, not core IP"
  - Add `engine/README.md`: "Nexiom Sync Engine — core IP. See docs/architecture/sync_strategy/"
  - Enforce via ESLint `import/no-restricted-paths` rule: `packages/*` must never import from `engine/*`

- Files:
  - `pnpm-workspace.yaml`
  - `turbo.json`
  - `tsconfig.json`
  - `engine/README.md`
  - `packages/README.md`
  - `engine/platform/core/` (was `packages/engine/`)
  - `engine/platform/piece-framework/` (was `packages/piece-framework/`)
  - `engine/application/connectors/` (was `packages/connectors/`)
  - `engine/application/pieces/` (was `packages/pieces/`)
- Depends: — (can start any time, phase 0 is prerequisite for T022B)

---

## Recommended Next Sprint (priority order)

> **Pipeline L3–L6 is now fully implemented and enterprise-hardened** (T028, T032–T035, T052 merged on `feat/pipeline-l3-l4-l5-l6`).
> The full L1→L6 data path is end-to-end complete. The following tasks are unblocked.

### Immediate — Architecture foundation

1. **T055 Phase 0** — Scaffold `engine/` directory + workspace config. Zero disruption. Prerequisite for T022B.
2. **T022B** — `MappingEngine` in `engine/application/mapping/`. First engine application code. Unblocks T023.

### Close the UI gap

1. **T023** — `StitchesPage` + `NewStitchPage` 3-step wizard (policy-driven connections, dependency discovery, no-code canvas + config tab). Depends on T022B.
2. **T024** — `StitchDetailPage` with Schedule Panel + Configuration Panel + Related Objects Panel.

### Observability (high-value, low-effort)

1. **T007** — OpenObserve dashboards + alerting: pipeline health (L1→L6 throughput, queue depths, error rates), token refresh metrics, DLQ spike alerts.

### Platform completeness

1. **T043** — `StorageResolverService` env-aware pool selection (sandbox vs production Aurora).
2. **T044** — `TokenManagerService` sandbox URL switching.
3. **T045** — Environment toggle in workspace creation + colour-coded badges.
4. **T012** — `TenantOffboardingService` GDPR data deletion.
5. **T040–T042** — AI-assisted mapping (MCP server, Claude mapping suggestions, Mapping Canvas button).

### Shared utility improvements (carry-over from enterprise hardening)

- **PinoLogger migration in `apps/worker`**: All pipeline services still use NestJS `Logger`. Migrate to `nestjs-pino` `PinoLogger` across L2–L6 worker services for consistent structured logging with `event`, `traceId`, `layer` context (deferred from T032–T035 hardening pass; belongs in a dedicated T006 follow-up).
- **GEM `orgId` population**: `sourceOrgId`/`destOrgId` are currently populated from `tenantId`. A future task should expose the real Salesforce org ID / QuickBooks realm ID from the connection `metadata` blob and thread it through the queue payload.
