# Technical Debt Register

Tracks known architectural shortcuts, design smells, and deferred improvements.
See also: [Architecture Review 2026-02](./architecture/architecture_review_2026_02.md)

---

## Connections Module

### TD-CON-01 — `realmId` Hardcoded in Generic OAuth Controller

**File**: `apps/api/src/modules/connections/connections/connectors.controller.ts`
**Severity**: Medium
**Effort**: ~1 day

**Problem**: `realmId` is a QuickBooks-specific concept (their company identifier) baked directly into the generic `exchangeCode` method and the OAuth state token. The generic controller should not know about any provider-specific concept. This violates the Open/Closed Principle — adding any other multi-instance provider (Xero, Salesforce sandbox/prod per-org) would require touching the same generic code.

**Current behaviour**: `connectionKey = realmId || 'default'` — all providers share this same logic even though only QuickBooks ever sends a realmId.

**Correct design**: Add an optional `getConnectionKey(callbackParams)` hook to `ProviderDefinition` in `@nexiom/connections`. The generic controller calls `provider.getConnectionKey?.(params) ?? 'default'`. QuickBooks' provider file implements `getConnectionKey: (p) => p.realmId`. Other providers stay unmodified.

**Related**: `credentialSetupMetadata` / `appCredentials.setupMetadata` also stores `env` — its only consumer is the `getActiveConnections` JOIN to reconstruct `env` in the response. This is an awkward cross-table read for what is effectively a read-model concern; consider a dedicated read-model or denormalization onto `appConnections` instead.

---

### TD-CON-02 — Two-Table Schema Diverges from Activepieces; Blocks Multi-Instance Connections

**Severity**: High
**Effort**: ~2–2.5 days (dev-only: no data migration required, just schema reset + `pnpm db:push`)

**Problem**: The current schema has two tables — `app_credential` (clientId + clientSecret) and `app_connection` (OAuth tokens). The original rationale was "one credential, many connections" (e.g. reuse one QuickBooks OAuth app across multiple companies). In practice, **each connection has its own clientId/clientSecret**, so the 1-to-many assumption is false and the separation adds complexity with no benefit.

More critically: the unique index is `(tenantId, appName, connectionKey)` where `connectionKey` defaults to `'default'`. This **prevents a tenant from having two Salesforce connections** (e.g. "TMS Salesforce" and "Marketing Salesforce") because both would get `connectionKey='default'` and collide.

**Correct design (Activepieces model)**: Collapse into one `app_connection` table:

| Column | Purpose |
|---|---|
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
|---|---|
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

**File**: `apps/api/src/modules/identity/auth/auth.guard.ts`
**Severity**: Critical
**Effort**: 2–3 days

**Problem**: `getEnrichedSession()` fires 4–5 sequential DB queries per request. No caching layer exists. Will not scale past ~500 concurrent users.

**Fix**: Redis session cache with short TTL (30–60s). Invalidate on role/permission mutations.

---

### TD-AUTH-02 — Dual Auth Systems on Frontend

**Files**: `apps/web/src/app/providers/auth-provider.ts`, `apps/web/src/shared/lib/auth/AuthProvider.tsx`
**Severity**: High
**Effort**: 2–3 days

**Problem**: Two independent auth providers manage session state separately. Root cause of permission-caching bugs where one provider goes stale.

**Fix**: The custom `AuthProvider` (React Context) should be the single source of truth. The Refine `AuthProvider` adapter should delegate to it, not manage state independently.

---

### TD-AUTH-03 — Circular Dependency: AuthModule ↔ InvitationsModule

**Files**: `apps/api/src/modules/identity/auth/auth.module.ts`, `apps/api/src/modules/identity/invitations/invitations.module.ts`
**Severity**: High
**Effort**: ~1 day

**Problem**: Both modules `forwardRef` each other. `AuthModule` is already `@Global()` so `InvitationsModule` does not need to import it.

**Fix**: Move `complete-invite` endpoint to a dedicated controller, breaking the circular dependency.

---

## Database

### TD-DB-01 — Legacy `user.role` Coexisting with `member.role`

**File**: `packages/database/src/schema/`
**Severity**: Medium
**Effort**: 1–2 days

**Problem**: `user.role` (deprecated global string label) and `member.role` (authoritative FK to role table) are both read by the permissions resolver, creating two sources of truth for the same concept.

**Fix**: Deprecation migration — read exclusively from `member.role`, drop `user.role` after a transition period.

---

## Infrastructure

### TD-INF-01 — Redis Provisioned but Unused

**File**: `docker-compose.yml`
**Severity**: Low
**Effort**: Negligible

Redis is declared in docker-compose but no application code references it. Fine for now; pick it up as part of TD-AUTH-01.

---

## Dependency Hygiene

### TD-DEP-01 — Unused Dependencies

**Severity**: Low
**Effort**: ~1 hour

- `class-validator` / `class-transformer` — present in deps but all validation uses Zod exclusively
- `@bufbuild/protobuf` — no `.proto` files or usage found anywhere in the codebase
