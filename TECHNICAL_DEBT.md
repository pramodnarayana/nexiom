# Technical Debt

This document tracks known technical debt items that should be addressed in future sprints. Items are prioritized by impact and effort.

---

## High Priority

### 1. PII Cleanup Job for Sessions

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

### 2. Permission Caching Architecture

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

### 2. CI Integration for E2E Tests

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

### 3. Drizzle Monorepo Database Architecture

**Location**: `packages/database`, `packages/identity`, `apps/api`  
**Added**: 2026-02-22  
**Impact**: Developer Velocity, Migration Stability  
**Effort**: High (1 sprint)

**Current State (3 Compounding Issues)**:

1. **Monorepo Schema Fragmentation**: Drizzle ORM is designed to analyze a single folder of schemas. In Nexiom, schemas are split across `@nexiom/identity` and `@nexiom/database`, then aggregated in `apps/api`. Running Drizzle's migration scripts from the workspace packages lacks full context and breaks cross-package resolution in Drizzle Studio.
2. **Environment Variable Hell**: The database connection string lives in `apps/api/.env`. Running scripts from `packages/database` fails over missing credentials without brittle `source ../../apps/api/.env` injection, which further breaks if developer environments have different Postgres users.
3. **Broken Migration Snapshots**: Drizzle's history tracking (`drizzle/.drizzle/meta.json`) is corrupted due to a missing historical snapshot (`0001_jazzy_wild_child.sql`). Drizzle CLI currently refuses to run `db:migrate` natively because the migration chain is broken.

**Recommended Solution**:

- **Unify Schema Management**: Move the source of truth for all schema Generation and Migrations to the `apps/api` level where the `.env` execution context actually lives, or create a dedicated operational `packages/db-migrator` package that centrally imports all other packages and manages the single `drizzle.config.ts`.
- **Reset Migration History**: Generate a fresh baseline database schema and squash all historical migrations to reset the corrupted `.drizzle` snapshot folder.
- **Centralize DB Credentials**: Export a generic database URL resolution file that automatically paths to the root or `apps/api` `.env` regardless of which workspace is currently executing the CLI.

### 4. Shadow Mode Direct Trigger Imports

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

### 5. Drizzle Schema Consolidation (Modular Monolith)

**Location**: `packages/database`, `packages/identity`  
**Added**: 2026-03-05  
**Impact**: Code Architecture, Developer Velocity  
**Effort**: High (1 sprint)

**Current State**:

- The project follows a strict "Bounded Context" approach with database schemas separated across multiple packages (`@nexiom/identity` manages `organization`, `@nexiom/database` manages `app_connection` and `tenant`).
- While this prevents circular dependencies and provides strict microservice-style domain boundaries, it incurs the overhead of data duplication. Specifically, it necessitates an artificial `tenant` "anchor" table in the database package to shadow the real `organization` table.

**Recommended Solution**:

- Adopt the "Shared Database Architecture" (Monolithic DB Package) which is the industry standard for TS monorepos (e.g., Vercel, Cal.com, Supabase).
- Migrate all Drizzle schema files from `@nexiom/identity` directly into `@nexiom/database`.
- Make `@nexiom/database` the single source of truth for the entire database. All other packages will list it as a dependency.
- This allows `app_connection` to safely declare a TypeScript foreign key directly to `organization` without circular dependency errors.

---

## Medium Priority

### 1. Cross-Module AuthGuard Import

**Location**: `apps/api/src/modules/connections/connections/connectors.controller.ts`  
**Added**: 2026-02-23  
**Impact**: Code Architecture, Module Coupling  
**Effort**: Low (1 day)

**Current State**:

- `AuthGuard` is imported directly via a hardcoded relative path (`../../identity/auth/auth.guard`) from the `connections` module.
- Creates tight coupling between domains and breaks encapsulation.

**Recommended Solution**:

- **Shared Workspace Package**: Export `AuthGuard` from `@nexiom/identity/guards` if `identity` is built as a library.
- **Global Guard**: Register `AuthGuard` globally in `app.module.ts` via `APP_GUARD`.
- **Module Export**: Explicitly export `AuthGuard` from an `index.ts` within the `identity` module.

---

### 2. Enterprise-Grade Global Frontend UI Polish

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

### Low Priority

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
- Replace all imports of `IgtLogger` across the `@nexiom/connections` and `@nexiom/piece-*` packages with the enterprise-standard `pino` logger instance.
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

- The engine currently uses a Tier 4A database-driven piece registry. It dynamically resolves pieces from the `pieces` Drizzle table, but assumes the packages (`@nexiom/piece-*`) are already installed in the monorepo's `node_modules`.
- **Note on Terminology**:
  - **Connecting**: Tenants browse the "Marketplace Catalog" in their UI and click "Connect" to authorize a piece (e.g., Salesforce). This creates an `app_connection`. This requires zero platform changes.
  - **Installing**: Adding a *brand new, never-before-seen* integration to the catalog itself (e.g., adding Zendesk tomorrow).
- To allow the Nexiom platform administration team to **install** new integrations to the global catalog on the fly without requiring a code deployment or Node.js server restart, the system must dynamically `npm install` packages at runtime.

**Recommended Solution**:

1. **Out-of-Band Installer**: `PieceLoaderService` must **never** shell out to `npm install` during request handling — this mutates shared state and blocks the event loop. Instead, `PieceLoaderService.loadEnabledPieces()` should check whether `./plugins/@nexiom/piece-X` exists on disk and fail fast with a descriptive error (`"Piece X is not installed — trigger the admin installer job"`) if the artifact is missing. A dedicated admin job/service handles the actual `npm install` step out of band.
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
