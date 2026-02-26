# Technical Debt

This document tracks known technical debt items that should be addressed in future sprints. Items are prioritized by impact and effort.

---

## High Priority

### 1. Permission Caching Architecture

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

*No items currently tracked*

---

### Completed Items

*Items resolved will be moved here with completion date*
