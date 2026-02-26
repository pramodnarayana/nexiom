# Technical Debt Register

Tracks known architectural shortcuts, design smells, and deferred improvements.
See also: [Architecture Review 2026-02](./architecture/architecture_review_2026_02.md)

**Fields**:

- **Status**: Open | In Progress | Resolved
- **Owner**: Team or person responsible
- **Issue**: Link to tracking ticket (e.g., JIRA/GitHub Issue)

---

## Connections Module

### TD-CON-01 — `realmId` Hardcoded in Generic OAuth Controller

**Status**: Open
**Owner**: Unassigned
**Issue**: TBD
**File**: `apps/api/src/modules/connections/connections/connectors.controller.ts`
**Severity**: Medium
**Effort**: ~1 day

**Problem**: `realmId` is a QuickBooks-specific concept (their company identifier) baked directly into the generic `exchangeCode` method and the OAuth state token. The generic controller should not know about any provider-specific concept. This violates the Open/Closed Principle — adding any other multi-instance provider (Xero, Salesforce sandbox/prod per-org) would require touching the same generic code.

**Current behaviour**: `connectionKey = realmId || 'default'` — all providers share this same logic even though only QuickBooks ever sends a realmId.

**Correct design**: Add an optional `getConnectionKey(callbackParams)` hook to `ProviderDefinition` in `@nexiom/connections`. The generic controller calls `provider.getConnectionKey?.(params) ?? 'default'`. QuickBooks' provider file implements `getConnectionKey: (p) => p.realmId`. Other providers stay unmodified.

**See also**: TD-CON-02. Resolving TD-CON-02 (single-table `externalId`) may eliminate the `connectionKey = realmId || 'default'` workaround in `connectors.controller.ts` (specifically inside the `exchangeCode` logic) and could make implementing the `getConnectionKey` hook in `ProviderDefinition` unnecessary or require rework.

**Related**: `credentialSetupMetadata` / `appCredentials.setupMetadata` also stores `env` — its only consumer is the `getActiveConnections` JOIN to reconstruct `env` in the response. This is an awkward cross-table read for what is effectively a read-model concern; consider a dedicated read-model or denormalization onto `appConnections` instead.

---

### TD-CON-02 — Two-Table Schema Diverges from Activepieces; Blocks Multi-Instance Connections

**Status**: Resolved
**Owner**: Backend Team
**Issue**: TBD
**Severity**: High
**Effort**: ~2–2.5 days (dev-only: no data migration required, just schema reset + `pnpm db:push`. NOTE: This is only safe on a fresh database with no persistent data and can cause silent data loss otherwise. For any environment with existing data like staging, production, or seeded dev, a proper non-destructive SQL migration such as `DROP TABLE app_credential; ALTER TABLE app_connection...` must be used instead)

**Problem**: The current schema has two tables — `app_credential` (clientId + clientSecret) and `app_connection` (OAuth tokens). The original rationale was "one credential, many connections" (e.g. reuse one QuickBooks OAuth app across multiple companies). In practice, **each connection has its own clientId/clientSecret**, so the 1-to-many assumption is false and the separation adds complexity with no benefit.

More critically: the unique index is `(tenantId, appName, connectionKey)` where `connectionKey` defaults to `'default'`. This **prevents a tenant from having two Salesforce connections** (e.g. "TMS Salesforce" and "Marketing Salesforce") because both would get `connectionKey='default'` and collide.

**Correct design (Activepieces model)**: Collapse into one `app_connection` table:

| Column | Purpose |
| --- | --- |
| `id` | Internal UUID primary key |
| `externalId` | User-provided machine-readable slug e.g. `"salesforce-tms"` |
| `displayName` | Human-readable label e.g. `"TMS Salesforce"` |
| `tenantId` | Tenant scope |
| `appName` | Provider name |
| `value` | Encrypted blob — `{ clientId, clientSecret, accessToken, refreshToken, data: { realmId, instance_url, ... } }` |
| `status` | ACTIVE / EXPIRED / REVOKED |
| `expiresAt` | Token expiry |
| `metadata` | Plain JSONB for display info (connected email, env, etc.) |

Unique index: `(tenantId, externalId)` — provider-agnostic, user-controlled.

Drop `app_credential` table entirely.

**Files that change**:

| File | Change |
| --- | --- |
| `packages/database/src/schema/tenant.ts` | Rewrite `appConnections`, drop `appCredentials` |
| `packages/database/src/migrations/` | New migration — drop `app_credential`, alter `app_connection` |
| `apps/api/src/modules/connections/connectors.service.ts` | Rewrite `storeOAuthConnection` — single upsert |
| `apps/api/src/modules/connections/connections/connectors.controller.ts` | Update SELECT (no JOIN), add `externalId`/`displayName` to body, remove `realmId` special handling |
| `apps/api/src/modules/connections/connectors.service.spec.ts` | Update all mock DB assertions |
| `apps/api/src/modules/connections/connections/connectors.controller.spec.ts` | Update request/response shapes |
| `apps/web/src/modules/connections/api/connections.api.ts` | Update `ActiveConnectionResponse` type |
| `apps/web/src/modules/connections/components/ConnectAppCard.tsx` | Add `displayName`/`externalId` input fields |
| `apps/web/src/modules/connections/pages/ConnectionsPage.tsx` | Update connection list rendering |

**Total**: ~9 files, ~3–4 days of focused work including migration, tests, and frontend. No external dependency changes needed.

---

## Identity / Auth Module

### TD-AUTH-01 — N+1 Queries on Every Authenticated Request

**Status**: Open
**Owner**: Unassigned
**Issue**: TBD
**File**: `apps/api/src/modules/identity/auth/auth.guard.ts`
**Severity**: Critical
**Effort**: 2–3 days

**Problem**: `getEnrichedSession()` fires 4–5 sequential DB queries per request. No caching layer exists. Approximate — pending load testing — will not scale past ~500 concurrent users. (Recommend adding a follow-up task to validate with benchmarking).

**Fix**: Redis session cache with short TTL (30–60s). Invalidate on role/permission mutations. See **TD-INF-01** — Redis is already provisioned and must be wired into `getEnrichedSession()`.

---

### TD-AUTH-02 — Dual Auth Systems on Frontend

**Status**: Open
**Owner**: Frontend Team
**Issue**: TBD
**Files**: `apps/web/src/app/providers/auth-provider.ts`, `apps/web/src/shared/lib/auth/AuthProvider.tsx`
**Severity**: High
**Effort**: 2–3 days

**Problem**: Two independent auth providers manage session state separately. Root cause of permission-caching bugs where one provider goes stale.

**Fix**: The custom `AuthProvider` (React Context) should be the single source of truth. The Refine `AuthProvider` adapter should delegate to it, not manage state independently.

---

### TD-AUTH-03 — Circular Dependency: AuthModule ↔ InvitationsModule

**Status**: Open
**Owner**: Backend Team
**Issue**: TBD
**Files**: `apps/api/src/modules/identity/auth/auth.module.ts`, `apps/api/src/modules/identity/invitations/invitations.module.ts`
**Severity**: High
**Effort**: ~1 day

**Problem**: Both modules `forwardRef` each other. `AuthModule` is already `@Global()` so `InvitationsModule` does not need to import it.

**Fix**: Move `complete-invite` endpoint to a dedicated controller, breaking the circular dependency.

---

### TD-AUTH-04 — AuthGuard Direct Database Access Anti-Pattern

**Status**: Open
**Owner**: Backend Team
**Issue**: TBD
**File**: `apps/api/src/modules/identity/auth/auth.guard.ts`
**Severity**: High
**Effort**: ~3 days

**Problem**: Extending TD-AUTH-01, the `AuthGuard` currently queries the database directly using Drizzle to resolve user sessions and permissions. Guards are meant to be fast, synchronous, or rely on fast caching layers—coupling a Guard directly to the database ORM breaks separation of concerns and guarantees poor performance under load.
**Fix**: Refactor `AuthGuard` to strictly use a dedicated Session/Auth Service that implements Redis caching (as noted in TD-AUTH-01) and abstract away all direct ORM/Database imports from the Guard itself.

---

## Database

### TD-DB-01 — Legacy `user.role` Coexisting with `member.role`

**Status**: Open
**Owner**: Backend Team
**Issue**: TBD
**File**: `packages/database/src/schema/`
**Severity**: Medium
**Effort**: 1–2 days

**Problem**: `user.role` (deprecated global string label) and `member.role` (authoritative FK to role table) are both read by the permissions resolver, creating two sources of truth for the same concept.

**Fix**: Deprecation migration — read exclusively from `member.role`, drop `user.role` after a transition period.

---

### TD-DB-02 — Unified Database Gateway Strategy (Physical Separation)

**Status**: Open
**Owner**: Architecture Team
**Issue**: TBD
**Severity**: High
**Effort**: 2–3 weeks

**Problem**: The platform requires a multi-tenant architecture with dynamic database provisioning (Database-per-Tenant physical separation model). Currently, the routing/gateway layer to orchestrate connections between the Catalog DB (for tenant metadata) and the dynamically provisioned tenant-specific databases is not fully standardized or abstracted.
**Fix**: Implement a Unified Gateway Strategy where application requests are seamlessly routed to the correct physical tenant database based on the isolated context, decoupling data models from the Catalog DB `Tenant` model to avoid direct foreign key cross-database queries.

---

### TD-DB-03 — Direct Database Access in Domain Modules (Identity/Connections)

**Status**: Open
**Owner**: Architecture Team
**Issue**: TBD
**Severity**: High
**Effort**: 2-3 weeks

**Problem**: The `identity` and `connections` modules evaluate Drizzle queries directly against the imported DB client. In an enterprise design, modules should not be tightly coupled to the ORM nor maintain separate connection flows. Direct access prevents unified request-scoped transactions (Unit of Work) across module boundaries and makes mocking/testing difficult.
**Fix**: Introduce a Repository Pattern or a shared UnitOfWork injected via NestJS DI. Domain modules should rely on abstract interfaces for data access rather than referencing Drizzle schemas and the global DB client directly.

---

### TD-DB-04 — Lack of a Unified Database Manager (Migrations & Seeding)

**Status**: Open
**Owner**: DevOps / Backend Team
**Issue**: TBD
**Severity**: Medium
**Effort**: 1-2 weeks

**Problem**: Currently, database creation, schema migrations, and seeding are manual and disjointed (relying on `db:push` which causes silent data loss on existing environments). There is no programmatic DB Manager to gracefully handle tenant database provisioning, safe SQL migrations, and deterministic seeding for local/CI environments.
**Fix**: Re-architect the DB Manager. Implement a unified CLI and backend service capable of safely applying Drizzle migrations (`drizzle-kit migrate`), provisioning new tenant DBs programmatically, and running idempotent seed scripts gracefully.

---

## Infrastructure

### TD-INF-01 — Redis Provisioned but Unused

**Status**: Open
**Owner**: DevOps
**Issue**: TBD
**File**: `docker-compose.yml`
**Severity**: Low
**Effort**: Negligible

Redis is declared in docker-compose but no application code references it. Fine for now; pick it up as part of TD-AUTH-01.

---

## Dependency Hygiene

### TD-DEP-01 — Unused Dependencies

**Status**: Open
**Owner**: Unassigned
**Issue**: TBD
**Severity**: Low
**Effort**: ~1 hour

- `class-validator` / `class-transformer` — present in deps but all validation uses Zod exclusively
- `@bufbuild/protobuf` — no `.proto` files or usage found anywhere in the codebase

---

## User Interface & Design

### TD-UI-01 — Premium Frontend Aesthetic Upgrade (Activepieces/Retool style)

**Status**: Open
**Owner**: Frontend Team
**Issue**: TBD
**Severity**: Medium
**Effort**: 2-3 weeks

**Problem**: The current frontend relies on a basic baseline UI framework. It lacks the dynamic, premium design aesthetics (vibrant colors, smooth gradients, glassmorphism, micro-animations, tailored dark modes) typical of state-of-the-art enterprise builders like Activepieces or Retool.
**Fix**: Complete a design system overhaul. Enforce modern typography (e.g. Inter/Outfit), tailored HSL palettes, dynamic hover states, and smooth transition animations to deliver a "WOW" first impression. Replace generic structural components with custom, highly polished UI widgets.
