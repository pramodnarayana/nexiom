# Technical Debt

This document tracks known technical debt items that should be addressed in future sprints. Items are prioritized by impact and effort.

---

## High Priority

### 1. AI Orchestrator & MCP Architecture Refactoring

**Location**: `engine/application/ai`, `engine/platform/ai` (or similar MCP directories), and `engine/application/pieces`
**Added**: 2026-04-08
**Impact**: Code Architecture, Domain-Driven Design, Platform Scalability
**Effort**: High (1 sprint)

**Current State**:
- The AI Copilot, MCP (Model Context Protocol), and the Sync Engine are currently conflated under the `engine` directory.
- This mixes two fundamentally opposed execution contexts: Sync Engine (async, batch, high-throughput ETL) and AI Orchestrator (sync, low-latency, real-time LLM streaming).
- MCP logic is incorrectly positioned within `engine/platform/`, despite having no relevance to database replication or webhook syncing.
- `pieces` (Integrations) are trapped under `engine/application/pieces`, making them appear bound strictly to the Sync Engine when they should be universally accessible.

**Recommended Solution**:
- **Extract Integrations**: Move `engine/application/pieces` into a shared top-level library (e.g., `packages/integrations` or `/integrations`). Both Sync and AI domains will import from this single source of truth.
- **Promote AI Domain**: Extract AI components out of `engine` into a dedicated top-level `ai/` or `engines/ai/` directory. This ensures AI logic doesn't inherit unnecessary ETL pipeline dependencies.
- **Relocate MCP**: Move the Model Context Protocol abstractions out of `engine/platform/` into the new dedicated AI domain architecture.


### 2. Hardened L3 & L4 Pipeline Outbox Refactoring

**Location**: `apps/worker/src/modules/pipeline/normalization.service.ts`, `apps/worker/src/modules/pipeline/fanout.service.ts`  
**Added**: 2026-03-29 (Updated: 2026-04-20)  
**Impact**: Reliability, Data Integrity, Architecture  
**Effort**: Medium (2-3 days)

**Current State**:

- L1->L2 and L2->L3 boundaries have been successfully migrated to the Debezium CDC pipeline (`inbound_outbox` and `replica_outbox` trigger SQS directly).
- However, the L3 (`NormalizationService`) -> L4 (`FanOutService`) boundary is incomplete regarding event-driven routing.
- While `normalized_outbox` has been created and is actively written to transactionally by L3, it is **not registered in the Debezium publication** during trigger enablement, and the `CdcRelayController` does not listen for inserts to this table.
- As a result, the L3->L4 handoff still relies on a legacy cron-polling service (`NormalizedOutboxService`), which wastes database CPU and prevents true real-time elasticity.

**Recommended Solution**:

- **Update Publication**: Modify `trigger-executor.service.ts` to dynamically include `normalized_outbox` alongside `inbound_outbox` and `replica_outbox` in the `ALTER PUBLICATION nexiom_cdc ADD TABLE...` script.
- **Relay Controller**: Add an `else if (__table === 'normalized_outbox')` routing branch in `apps/api/src/modules/pipeline/cdc-relay.controller.ts` to push those CDC payloads to the L4 FanOut SQS Queue.
- **Cleanup**: Delete the legacy cron-polling `NormalizedOutboxWorker` entirely.

---

### 3. DatabaseManager Duplication

**Location**: `apps/api/src/db/database-manager.ts`, `apps/worker/src/db/database-manager.ts`  
**Added**: 2026-03-27  
**Impact**: Code Architecture, DRY Violation  
**Effort**: Low (0.5 days)

**Current State**:

- Identical `DatabaseManager` implementations are duplicated across both the API and Worker applications.
- This creates multiple sources of truth for database module initialization, seeding, and migration execution, increasing the risk of configuration drift.
- Although `@soopa/dbmanager` exists, it currently only exports TypeScript interfaces rather than the concrete implementation.

**Recommended Solution**:

- Move the concrete `DatabaseManager` implementation into `@soopa/dbmanager`.
- Export a global `DbManagerModule` from that package.
- Delete the redundant files in both `apps/api` and `apps/worker` and refactor them to import the unified library service.

### 4. PII Cleanup Job for Sessions

**Location**: `packages/database/src/schema/identity.ts` & `apps/api/src/modules/background`  
**Added**: 2026-03-06  
**Impact**: Compliance, Security, Data Privacy  
**Effort**: Medium (1-2 days)

**Current State**:

- The `session` table currently exposes raw `ipAddress` and `userAgent` fields indefinitely.
- There is no automated cleanup or anonymization of this Personally Identifiable Information (PII).

**Recommended Solution (Time-bounded retention model chosen)**:

- Keep raw IP/user-agent on insert for security auditing.
- Remove or rename the legacy `anonymizeIp` and `anonymizeUserAgent` pre-insert helpers if they exist.
- Implement `runPIICleanup` inside the `background`/`jobs` module using `@nestjs/schedule` to run daily.
- This job will find sessions older than 30 days and anonymize their PII (nullify or hash), emitting audit logs.
- Add a Drizzle migration to backfill and anonymize existing old sessions.

### 5. Permission Caching Architecture

**Location**: `apps/web/src/app/providers/auth-provider.ts`  
**Added**: 2026-02-12  
**Impact**: Performance, Scalability  
**Effort**: Medium (1-2 days)

**Current State**:

- `getPermissions()` makes a network call to `/api/users/me` on every invocation
- No caching mechanism in place
- Can result in 50+ API calls per user session for permission checks

**Recommended Solution**:
Adopt industry-standard data-fetching library (React Query or SWR):

- Automatic caching with configurable TTL
- Request deduplication
- Background refetching strategies
- Built-in devtools for debugging
- Observable cache metrics

**Enterprise Examples**:

- Stripe: React Query for all API state
- GitHub: Custom cache service with Redis
- Salesforce: Dedicated CacheService class

**Alternative**: Build custom cache service with:

- Dedicated `PermissionCacheService` class
- Environment-based configuration
- LRU eviction policy
- Cache warming on login
- Monitoring/observability hooks

**References**:

- [Permission Architecture Pattern](file:///.gemini/antigravity/brain/d18e0ee0-ce96-4db3-9e9a-041242a6c761/permission_architecture_pattern.md)

### 6. CI Integration for E2E Tests

**Location**: `apps/web/e2e`  
**Added**: 2026-02-19  
**Impact**: Reliability, Automation  
**Effort**: Medium (1-2 days)

**Current State**:

- E2E tests run successfully in local environment with `start-test-env.sh`.
- Tests rely on a local Mailpit instance (`docker compose up`) and local DB.
- No automated CI workflow for these tests.

**Recommended Solution**:

- Configure a service container for Mailpit in GitHub Actions.
- Ensure the database is accessible or service-containerized in CI.
- Update the CI workflow to enable `VITE_AUTH_GOOGLE_ENABLED=true`.

### ~~3. Centralized Schema & Migrations~~ ✅ RESOLVED (2026-03-27)

**Location**: `packages/database`, `apps/api`, `apps/worker`

**Resolution**:

- **Single Source of Truth**: All Drizzle schemas, `drizzle.config.ts`, and `drizzle/` migrations folder live exclusively in `@soopa/database`.
- **Root-level DDL commands**: `pnpm db:migrate`, `pnpm db:generate`, `pnpm db:studio` — all delegate to `@soopa/database` via the root `package.json`.
- **Consumer packages are DDL-free**: `apps/api` and `apps/worker` no longer have `drizzle-kit` in devDependencies or any `db:generate`/`db:migrate`/`db:studio` scripts.
- **dotenv auto-resolution**: `drizzle.config.ts` in `@soopa/database` loads `DATABASE_URL` from `apps/api/.env` automatically so all root commands work without manual env sourcing.
- **Enterprise Piece Loader**: `PiecesModule` is now a DynamicModule with `forRoot({ anchorUrl: import.meta.url })`. All 6 host modules (ConnectionsModule, StitchesModule, TriggerModule, SchedulerModule, WebhooksModule, PipelineModule) pass their own `import.meta.url` as the resolution anchor, bypassing pnpm strict package containment in any working directory or container.

### 7. Shadow Mode Direct Trigger Imports

**Location**: `packages/pieces/salesforce/src/lib/trigger/universal-trigger.ts` & Quickbooks  
**Added**: 2026-03-04  
**Impact**: Code Architecture, Module Coupling  
**Effort**: Low (0.5 days)

**Current State**:

- Universal triggers directly import `newContact` and `newLead` (and their QuickBooks equivalents) to run Shadow Mode data parity checks.
- This creates tight coupling and a code smell where the generic engine is strongly typed against the old implementations it's supposed to replace.

**Recommended Solution**:

- **Short term**: Complete Phase 3 testing (i.e., validate that the universal polling engine achieves 100% data parity and stability over a 2-week dual-run window; refer to the [QA Test Plan](/docs/qa/shadow_mode_test_plan.md) for exit criteria) and delete the legacy stubs immediately, removing the imports.
- **Long term (if kept)**: Implement a Dependency Injection registry where legacy triggers self-register for shadow testing, keeping `universal-trigger.ts` completely unaware and decoupled.

### 8. Drizzle Schema Consolidation (Modular Monolith)

**Location**: `packages/database`, `packages/identity`  
**Added**: 2026-03-05  
**Impact**: Code Architecture, Developer Velocity  
**Effort**: High (1 sprint)

**Current State**:

- The project follows a strict "Bounded Context" approach with database schemas separated across multiple packages (`@soopa/identity` manages `organization`, `@soopa/database` manages `app_connection` and `tenant`).
- While this prevents circular dependencies and provides strict microservice-style domain boundaries, it incurs the overhead of data duplication. Specifically, it necessitates an artificial `tenant` "anchor" table in the database package to shadow the real `organization` table.

**Recommended Solution**:

- Adopt the "Shared Database Architecture" (Monolithic DB Package) which is the industry standard for TS monorepos (e.g., Vercel, Cal.com, Supabase).
- Migrate all Drizzle schema files from `@soopa/identity` directly into `@soopa/database`.
- Make `@soopa/database` the single source of truth for the entire database. All other packages will list it as a dependency.
- This allows `app_connection` to safely declare a TypeScript foreign key directly to `organization` without circular dependency errors.

---

## Medium Priority

### 1. Capability URL Webhook Routing (Slug + Secret Token)

**Location**: `apps/api/src/modules/webhooks/webhooks.controller.ts`, `apps/api/src/guards/tenant-rate-limit.guard.ts`
**Added**: 2026-04-21
**Impact**: Customer Experience, API Security
**Effort**: Medium (2 days)

**Current State**:
- Webhooks currently use the raw internal UUID of the connection (`POST /webhooks/:connectionId`), making them secure against brute-forcing but unpolished for enterprise customers.
- We cannot safely switch to a purely human-readable composite slug (e.g., `POST /webhooks/:orgSlug/:connectionSlug`) without a cryptographic signature requirement. Otherwise, malicious actors (or internal tenant misconfigurations) could trivially guess paths and forge cross-tenant data.

**Recommended Solution**:
- Implement the "Capability URL" pattern.
- Generate and store a secure random token (e.g., `sk_8a49c2b1x9`) for each `app_connection` record.
- Update the webhook controller route to act as a hybrid: `POST /webhooks/:orgSlug/:connectionSlug/:secretToken`.
- Validate the URL secret mathematically against the database upon ingest. This achieves both a branded, customer-friendly URL and Zapier-style cryptographic un-guessability simultaneously.

**Migration Strategy & Rollout Plan**:

1. **Dual-Mode Routing (Transition Window)**:
   - Support both legacy `POST /webhooks/:connectionId` and new `POST /webhooks/:orgSlug/:connectionSlug/:secretToken` routes simultaneously during a 90-day deprecation window.
   - Update `webhooks.controller.ts` to handle both route patterns and resolve them to the same internal handler.
   - Add deprecation warning headers (e.g., `X-Deprecation-Warning: "Legacy endpoint; migrate to /webhooks/:orgSlug/:connectionSlug/:secretToken by <sunset-date>"`) to legacy route responses, where `<sunset-date>` is computed from a central config value (e.g., `config.WEBHOOK_LEGACY_SUNSET_DATE` or `getSunsetDate()`) and formatted as YYYY-MM-DD.

2. **Backfill Secret Tokens**:
   - Create a database migration to add a `webhook_secret_hash` column to `app_connection` table.
   - Backfill existing connections with cryptographically secure random tokens (e.g., using `crypto.randomBytes(16).toString('hex')`), storing the derived secure hash (e.g., HMAC-SHA256 or salted SHA-256) in `webhook_secret_hash`.
   - Ensure the migration is idempotent and preserves existing hashes if re-run.
   - **Storage & Validation Security**: Store only the derived secure hash (HMAC-SHA256 or salted SHA-256) of the webhook secret in the `webhook_secret_hash` column, never plaintext. Update any resolution/validation code (e.g., `resolveWebhookSecret`, `validateWebhookToken`, or equivalent lookup by `orgSlug/connectionSlug`) to compute the same HMAC/hash from the presented token and perform a constant-time comparison (e.g., using `crypto.timingSafeEqual`). Implement rate-limiting for failed token validations (max 10 failed attempts per `orgSlug/connectionSlug` pair per minute with exponential backoff or temporary lockout). Mandate logging of all failed webhook validation attempts including IP address and timestamp for security audit trails.

3. **Token Rotation & Revocation**:
   - Implement an API endpoint (e.g., `POST /api/connections/:id/rotate-webhook-secret`) to allow customers to regenerate their webhook secret.
   - Store token generation timestamp to support automatic expiry policies if needed in the future.
   - Add audit logging for all token rotation events.

4. **Rate-Limiting Updates**:
   - Update `tenant-rate-limit.guard.ts` to apply rate limiting consistently across both legacy and new routes.
   - Ensure rate limit keys are normalized to the connection ID regardless of which route format is used.

5. **Customer Communication Plan**:
   - **T-90 days**: Announce new Capability URL feature in release notes and documentation; send email to all customers with migration guide.
   - **T-60 days**: Add in-app banners for users still using legacy webhook URLs, with one-click "Copy New URL" button.
   - **T-30 days**: Send reminder emails with deprecation timeline and support contact.
   - **T-7 days**: Final warning email highlighting exact sunset date.
   - **T-0 days**: Disable legacy route; return HTTP 410 Gone with migration instructions in response body.

6. **Rollback Safety**:
   - Keep legacy route code in place but feature-flagged for 30 days post-sunset to allow emergency rollback if needed.
   - Monitor error rates and customer support tickets closely during transition period.

**Estimated Timeline**: 90-day deprecation window with implementation effort of 2 days for dual-mode routing + 1 day for migration tooling.


### 1. Kubernetes Grace Period vs Hardcoded Drain Timeout

**Location**: `apps/api/src/core/shutdown.service.ts`
**Added**: 2026-03-25
**Impact**: Infrastructure, Process Lifecycle
**Effort**: Low (0.5 days)

**Current State**:

- The application hardcodes `DRAIN_TIMEOUT_MS = 25s` to exit gracefully before Kubernetes sends a `SIGKILL` at the end of its default 30-second `terminationGracePeriodSeconds`.
- This relies on implicit knowledge of the default K8s configuration. If a DevOps engineer changes the K8s manifest without updating the Node.js source code (or vice-versa), it can lead to truncated drains and zombie processes.

**Recommended Solution**:

- Make `DRAIN_TIMEOUT_MS` configurable via environment variable (e.g., `SHUTDOWN_DRAIN_TIMEOUT_MS`).
- Explicitly define `terminationGracePeriodSeconds` in the Kubernetes deployment manifests (e.g., to 35s) and inject `SHUTDOWN_DRAIN_TIMEOUT_MS=30000` via a ConfigMap, codifying the relationship in Infrastructure-as-Code.

---

### 1. True Enterprise DX Setup (DevContainers & Secret Manager)

**Location**: Workspace Root  
**Added**: 2026-04-02  
**Impact**: Developer Experience, Security, Onboarding  
**Effort**: High (1-2 sprints)

**Current State**:

- Local development relies on a `setup:local` package script and a local `.env` file that developers must manually fetch and configure.
- Node.js versions, OS differences, and local caching issues can still slightly differentiate environments between developers.

**Recommended Solution**:

- **Automated Secrets**: Integrate a CLI-based secret manager (e.g., 1Password CLI `op run`, Doppler, or Infisical) to dynamically inject environment variables at runtime, eliminating the physical `.env` file from local machines.
- **DevContainers**: Implement `.devcontainer/devcontainer.json` to fully orchestrate the development environment. This allows seamless "Open in GitHub Codespaces" or VSCode DevContainers, guaranteeing absolute OS and dependency parity across the entire team without installing anything but Docker.

---

### 2. Vector Sink Alerting / Dropped Logs

**Location**: `vector/vector.toml`
**Added**: 2026-03-25
**Impact**: Observability, Alerting
**Effort**: Medium (1-2 days)

**Current State**:

- The Vector sidecar is configured to buffer logs in memory and drop the newest logs (`when_full = "drop_newest"`) if the OpenObserve sink goes down or is unreachable.
- This prevents the API container from hanging, but results in silent log loss because there is no external alerting configured for when Vector drops logs.

**Recommended Solution**:

- Configure Vector's internal metrics sink to expose `vector_buffer_discarded_events_total` to Prometheus/Grafana.
- Set up an alert (e.g., PagerDuty or Slack) that triggers whenever logs are actively being dropped, indicating an issue with the logging infrastructure.

## Observability Edge Cases

### 1. Cross-Module AuthGuard Import

**Location**: `apps/api/src/modules/connections/connections/connectors.controller.ts`  
**Added**: 2026-02-23  
**Impact**: Code Architecture, Module Coupling  
**Effort**: Low (1 day)

**Current State**:

- `AuthGuard` is imported directly via a hardcoded relative path (`../../identity/auth/auth.guard`) from the `connections` module.
- Creates tight coupling between domains and breaks encapsulation.

**Recommended Solution**:

- **Shared Workspace Package**: Export `AuthGuard` from `@soopa/identity/guards` if `identity` is built as a library.
- **Global Guard**: Register `AuthGuard` globally in `app.module.ts` via `APP_GUARD`.
- **Module Export**: Explicitly export `AuthGuard` from an `index.ts` within the `identity` module.

---

### 1. Enterprise-Grade Global Frontend UI Polish

**Location**: `apps/web/src/*`
**Added**: 2026-02-24
**Impact**: User Experience, Product Quality, Brand Perception
**Effort**: High (1-2 sprints)

**Current State**:

- The application uses functional standard Shadcn components, but lacks a cohesive premium aesthetic.
- "Active" states, data loading, and layout transitions are visually basic.
- No unified animation system for modals, page transitions, or micro-interactions.
- Dark mode requires fine-tuning regarding contrast, borders, and textures.

**Recommended Solution**:

- **System-wide Animations**: Implement Framer Motion for page layouts, modal slide-ins, and shared component layout changes.
- **Premium Textures & Micro-interactions**: Integrate glassmorphism (backdrop-blur), gradient mesh backgrounds on empty states, and interactive hover states (e.g., animated borders, color shifts).
- **Data Loading**: Replace generic spinners in dashboards and lists with beautiful, grid-matching skeleton loaders.
- **Status Indication**: Transition away from static text badges to live, pulsing status indicators (e.g., `🟢` for connected/healthy states) similar to Vercel/Supabase.

---

### ~~2. Drizzle-Kit ESM Module Resolution~~ ✅ RESOLVED (2026-03-31)

**Location**: `packages/database/drizzle.config.ts`, `packages/database/package.json`
**Added**: 2026-03-30
**Impact**: Developer Experience, CI/CD Pipeline Reliability
**Effort**: Low (0.5 days)

**Resolution**:

- **Implemented Option A**: Permanently locked `drizzle.config.ts` to `schema: './dist/schema/*.js'` and updated *all* DDL script entries (`db:generate`, `db:migrate`, `db:studio`) to compile first automatically (`"db:generate": "pnpm build && drizzle-kit generate"`, etc.). This bypassed jiti's loader failures with ESM `.js` extensions while ensuring all commands are fully robust in fresh environments (enterprise-grade).

---

### 3. Centralized Mock Gateway / Mock Service Worker (MSW)

**Location**: `docker-compose.yml`, `apps/api`, `apps/worker`
**Added**: 2026-03-31
**Impact**: Infrastructure Scalability, Developer Experience, RAM utilization
**Effort**: Low (remaining tasks)

**Current State**:

- Local development now uses a centralized `mock_gateway` container to serve mocks instead of individual Prism containers.
- Option A (Centralized Mock Server) is successfully implemented and active in docker-compose.
- Remaining gaps:
  - Dynamic loading from `packages/pieces/*/openapi.json` edge-cases need monitoring.
  - The routing pattern `/mock/{vendor}/...` requires integration notes for `apps/api` and `apps/worker`.

**Recommended Solution**:

- ✅ Option A (Centralized Mock Gateway) is implemented.
- Finalize documentation for API/Worker pointing to the mock gateway.
- Option B (MSW Network Interception) can be tracked as an optional future alternative if Docker network overhead becomes an issue.

---

## Low Priority

### 1. Replace custom Logger with Pino

**Location**: `packages/connections/src/intelligence/igt-logger.ts`  
**Added**: 2026-03-05  
**Impact**: Observability, Standardization  
**Effort**: Low (0.5 days)

**Current State**:

- The `IgtLogger` is a custom implementation written specifically for the Intelligence Engine.
- While functional, it does not adhere to the enterprise standard of using `pino` for structured, high-performance logging.
- Lacks integration with standard log forwarders or shared configuration that a unified `pino` logger would provide.

**Recommended Solution**:

- Deprecate and remove `igt-logger.ts`.
- Replace all imports of `IgtLogger` across the `@soopa/connections` and `@soopa/piece-*` packages with the enterprise-standard `pino` logger instance.
- Ensure log levels and metadata context remain structured to avoid breaking existing observability dashboards.

---

## Intelligent Generic Trigger (IGT) — Known Limitations

> These are documented trade-offs, not bugs. The core engine is correct and data-safe.

### 1. CDC Path Not Implemented

**Location**: `packages/pieces/salesforce/src/lib/trigger/universal-trigger.ts`
**Added**: 2026-03-04
**Impact**: Performance, API Call Efficiency
**Effort**: High (1 sprint)

**Current State**:

- When `hint.preferPath === 'CDC'` is configured, the engine emits a warning and falls back to REST polling.
- Change Data Capture is the preferred path for high-volume, high-frequency objects (e.g. objects receiving thousands of updates per minute) as it eliminates polling latency and reduces API call consumption.

**Recommended Solution**:

- Implement a Salesforce Platform Event subscription for CDC.
- Persist a replay ID in `TriggerStore` to resume from the last processed event after restarts.
- Add `executeCDCQuery` to `UniversalEngineConfig` as an optional path the engine routes to when `hint.preferPath === 'CDC'`.

---

### 2. No Salesforce API Call Budget Tracking

**Location**: `packages/connections/src/apps/salesforce/sf-fetch.ts`, `packages/connections/src/intelligence/universal-trigger-engine.ts`
**Added**: 2026-03-04
**Impact**: Reliability, Org Stability
**Effort**: Medium (2-3 days)

**Current State**:

- The engine does not track or throttle API calls against Salesforce org limits (typically ~15,000 calls/day on standard orgs, higher on Enterprise/Unlimited).
- At high polling frequency across many objects, flows could exhaust the org's daily API limit with no early warning.

**Recommended Solution**:

- Poll the Salesforce Limits API (`/services/data/vXX.0/limits`) periodically and cache the result in a shared store.
- Emit a structured warning log when remaining calls drop below a configurable threshold (e.g. 20%).
- Back off automatically when Salesforce returns `REQUEST_LIMIT_EXCEEDED` (HTTP 403).

---

### 3. Shadow Mode Is Process-Wide, Not Per-Flow

**Location**: `packages/pieces/salesforce/src/lib/trigger/universal-trigger.ts`
**Added**: 2026-03-04
**Impact**: Deployment Flexibility
**Effort**: Low (1 day)

**Current State**:

- Shadow mode is controlled by the `IGT_SHADOW_MODE` environment variable, which applies to the entire process.
- All flows on a node enable or disable shadow mode together — it is not possible to shadow-test a single flow while others run in full production mode.

**Recommended Solution**:

- Add a `shadowMode` boolean to the flow's trigger configuration (stored in the database).
- Read it from `TriggerStore` or `propsValue` at poll time instead of the environment variable.
- Retain the env var as a global override for emergency rollback.

---

### 4. Marketplace Piece Registry (Tier 4B)

**Location**: `apps/api/src/modules/pieces/piece-loader.service.ts`
**Added**: 2026-03-07
**Impact**: Deployment Flexibility, Marketplace Readiness
**Effort**: High (1-2 sprints)

**Current State**:

- The engine currently uses a Tier 4A database-driven piece registry. It dynamically resolves pieces from the `pieces` Drizzle table, but assumes the packages (`@soopa/piece-*`) are already installed in the monorepo's `node_modules`.
- **Note on Terminology**:
  - **Connecting**: Tenants browse the "Marketplace Catalog" in their UI and click "Connect" to authorize a piece (e.g., Salesforce). This creates an `app_connection`. This requires zero platform changes.
  - **Installing**: Adding a *brand new, never-before-seen* integration to the catalog itself (e.g., adding Zendesk tomorrow).
- To allow the Nexiom platform administration team to **install** new integrations to the global catalog on the fly without requiring a code deployment or Node.js server restart, the system must dynamically `npm install` packages at runtime.

**Recommended Solution**:

1. **Out-of-Band Installer**: `PieceLoaderService` must **never** shell out to `npm install` during request handling — this mutates shared state and blocks the event loop. Instead, `PieceLoaderService.loadEnabledPieces()` should check whether `./plugins/@soopa/piece-X` exists on disk and fail fast with a descriptive error (`"Piece X is not installed — trigger the admin installer job"`) if the artifact is missing. A dedicated admin job/service handles the actual `npm install` step out of band.
2. **Security Allowlist**: Validate package names against a signed registry to prevent malicious arbitrary code execution.
3. **Sandboxing**: A bug in a dynamically loaded piece can crash the main API process. **`worker_threads` do NOT provide crash isolation** — they run in the same Node.js process. True isolation requires separate processes or containers (e.g., `child_process`, containerized workers, or a dedicated worker microservice).
4. **Persistent Storage**: Ensure the `./plugins` directory lives on a persistent volume (e.g., EFS) so container restarts don't re-trigger installs and cause slow cold starts.

---

### Completed Items

Items proposed or resolved will be tracked here.

### 5. Frontend UI Unification (Legacy Provider Registry Deprecation)

**Location**: `apps/api/src/modules/connections/connections/connectors.controller.ts`, `apps/web/src/modules/connections/components/DynamicAuthForm.tsx`  
**Added**: 2026-03-07  
**Status**: Proposed / In progress (see PR `#86`)  
**Impact**: Unified generic UI, Developer Experience  
**Effort**: Medium (About 15 files)

**Proposed Changes**:

1. **API Modernization**: Proposed: delete `ProviderRegistryService` and update `connectors.controller.ts` and `connectors.service.ts` to use `PieceAuth` definitions from `PieceRegistryService` for mapping `tokenUrl`, `authUrl`, and `clientId` dynamically.
2. **Frontend Simplification**: Proposed: remove hardcoded `env` in `DynamicAuthForm.tsx` and `oauth-state.service.ts`; render environment via `uiSchema`/`vendorParams` so any custom field flows through generically.