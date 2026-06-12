# Comprehensive Architecture Review: Soopa Platform

**Date**: February 2026
**Overall Grade**: B+

## 1. Overall Project Structure and Organization

**Architecture Style**: Turborepo monorepo with two applications and one shared library package.

```text
soopa-monorepo/
  apps/
    api/          NestJS backend (Control Plane / API Gateway)
    web/          React+Vite frontend (Dashboard / Admin Desk)
  packages/
    identity/     Shared identity library (schemas, adapters, interfaces)
  scripts/        Operational utilities
  docs/           Architecture documentation (active + archived)
```

**Assessment**: The monorepo structure is clean and appropriate for a project of this size (roughly 80 source files total across all packages). The use of Turborepo with pnpm workspaces is a solid choice for coordinating builds between the API, web app, and shared identity package. The `apps/*` vs `packages/*` boundary is clear: apps are deployable, packages are shared libraries.

---

## 2. Technology Stack and Dependencies

### Backend (`apps/api`)

| Layer | Technology | Version | Assessment |
|-------|-----------|---------|------------|
| Framework | NestJS | 11.x | Current, well-suited for B2B platform with strong DI |
| ORM | Drizzle ORM | 0.45.x | Modern, type-safe, good PostgreSQL support |
| Database | PostgreSQL | 15 (via Docker) | Enterprise-grade choice |
| Auth | Better Auth | 1.4.x | Self-hosted auth library -- less mature than alternatives |
| Validation | Zod + nestjs-zod | 4.x / 5.x | Modern schema validation, good choice |
| Email | Nodemailer | 7.x | Industry standard |
| Caching | Redis (in docker-compose) | alpine | Provisioned but not yet integrated into application code |

### Frontend (`apps/web`)

| Layer | Technology | Version | Assessment |
|-------|-----------|---------|------------|
| Framework | React | 19.x | Latest, good |
| Build | Vite | 5.x | Fast, modern bundler |
| Routing | React Router | 7.x | Current |
| Admin Framework | Refine | 4.58.x | Opinionated CRUD admin framework |
| UI Components | Radix UI + Tailwind CSS + shadcn | Various | Solid, accessible component library |
| HTTP Client | Axios | 1.13.x | Mature, but redundant alongside fetch |
| State | React Context | (built-in) | Adequate for current size |

### Shared (`packages/identity`)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Schema | Drizzle ORM | Single schema source of truth |
| Auth | Better Auth | Adapter wraps the library |
| Hashing | bcryptjs | Password hashing |
| IDs | uuid v4 | Standard UUIDs |

### Key Observations

1. **Better Auth risk**: Better Auth is a relatively young library. The adapter has to work around its APIs extensively -- notably the `BetterAuthApi` interface is locally defined because the library does not export typed API surfaces. Multiple `eslint-disable` comments for unsafe casts reinforce this. This is the single largest technology risk in the project.

2. **Redis provisioned but unused**: The docker-compose includes Redis, but no application code references it. Fine for future use but represents dead infrastructure.

3. **Dual validation systems**: The API uses both `class-validator`/`class-transformer` (dependencies present) AND Zod (`nestjs-zod`). The actual code uses Zod exclusively -- the class-validator/class-transformer deps should be removed.

4. **Protobuf dependency**: `@bufbuild/protobuf` is listed in API dependencies but no `.proto` files or usage found. May be a premature dependency.

---

## 3. Architectural Patterns

### Primary: Ports & Adapters (Hexagonal Architecture) in the Identity Package

The `packages/identity` package follows a textbook hexagonal architecture pattern. This is the strongest architectural decision in the codebase.

```text
                     +----------------------------+
                     |      INTERFACES (Ports)     |
                     |  IAuthProvider              |
                     |  IUserProvider              |
                     |  ITenantProvider             |
                     |  IPermissionProvider         |
                     |  IRoleProvider               |
                     |  IEmailProvider              |
                     +----------------------------+
                              |           |
               +--------------+           +---------------+
               |                                          |
  +------------------------+              +----------------------------+
  |  ADAPTERS (Drizzle)    |              |  ADAPTER (Better Auth)     |
  |  DrizzleUserAdapter    |              |  BetterAuthAdapter         |
  |  DrizzleTenantAdapter  |              +----------------------------+
  |  DrizzlePermAdapter    |
  |  DrizzleRoleAdapter    |
  +------------------------+
```

This means swapping out Better Auth for another auth provider would require only writing a new adapter class implementing `IAuthProvider`. Similarly, swapping PostgreSQL for another database only requires new adapters.

### Secondary: NestJS Module Pattern (Backend)

```text
AppModule
  +-- DbModule (Global)
  +-- IdentityModule (Global, Dynamic)
  +-- AuthModule (Global)
  +-- UsersModule
  +-- TenantsModule
  +-- InvitationsModule
  +-- SystemAdminModule
  +-- RolesModule
  +-- EmailModule (Global)
```

### Tertiary: Feature-Module Pattern (Frontend)

```text
src/
  app/           App shell, routes, Refine providers
  modules/       Feature modules (identity, dashboard, tenants, marketing)
  shared/        Shared components, hooks, lib, contexts
```

---

## 4. Code Organization and Module Boundaries

### Backend Module Boundaries

**Good**: Controllers are thin and delegate to providers (injected via DI tokens). The API layer truly acts as an HTTP adapter to the identity ports.

**Concerning**: Circular reference exists:

```text
AuthModule --imports--> InvitationsModule (via forwardRef)
InvitationsModule --imports--> AuthModule (via forwardRef)
```

**Root cause**: `AuthController` imports `InvitationsService` for the `complete-invite` endpoint, while `InvitationsModule` imports `AuthModule` for guards. Since `AuthModule` is `@Global()`, `InvitationsModule` should not need to import it at all.

### Frontend Module Boundaries

**Concerning**: Two parallel auth systems exist:

1. `apps/web/src/app/providers/auth-provider.ts` -- Refine's `AuthProvider` interface
2. `apps/web/src/shared/lib/auth/AuthProvider.tsx` -- Custom React Context `AuthProvider`

Both independently manage session-fetching, permission resolution, and user hydration. This is the root cause of the permission-caching issue documented in `TECHNICAL_DEBT.md`.

---

## 5. Database Layer and Data Models

### Schema Design

The schema is defined in `packages/identity/src/schema.ts` and re-exported by `apps/api/src/db/schema.ts`. Single-source-of-truth approach is correct.

### Entity Relationships

```text
user (1)---(*) session
user (1)---(*) account         [OAuth + credential providers]
user (1)---(*) member          [organization memberships]
organization (1)---(*) member
organization (1)---(*) invitation
role (1)---(*) member          [via member.role FK]
role (1)---(*) role_permission
permission (1)---(*) role_permission
role_permission ---? organization  [nullable - global vs scoped permissions]
```

### Strengths

- Organization-scoped RBAC with proper normalization
- Soft delete support (`deletedAt` on user, organization, member)
- Partial unique indexes that respect soft deletes
- Sentinel value strategy for nullable unique constraints

### Weaknesses

1. **Legacy `user.role` field**: Both `user.role` (deprecated global label) and `member.role` (authoritative FK to role table) exist and are actively read
2. **Text primary keys everywhere**: No constraint ensuring IDs are valid UUIDs
3. **`metadata` stored as `text`**: Should use PostgreSQL native `jsonb`

---

## 6. API Design and Routing

### Route Map

```text
GET  /api                          Health check
POST /api/auth/login               Email login
POST /api/auth/signup              Registration
POST /api/auth/provision-tenant    Auto-provision for social login
POST /api/auth/resend-verification Resend email verification
POST /api/auth/complete-invite     Complete invitation flow
POST /api/auth/refresh-session     Get enriched session
ALL  /api/auth/*                   Better Auth passthrough
GET  /api/users/me                 Current user profile
GET  /api/users                    List users (tenant-scoped)
POST /api/users                    Create user
GET  /api/users/:id                Get user
DELETE /api/users/:id              Delete user
GET  /api/tenants                  List user tenants
GET  /api/tenants/:id              Get tenant
PATCH /api/tenants/:id             Update tenant status
PATCH /api/tenants/:id/details     Update tenant details
POST /api/invitations              Create invitation
GET  /api/invitations/:id          Get invitation (public)
POST /api/invitations/accept       Accept invitation
GET  /api/invitations              List invitations
GET  /api/admin/users              System admin: list users
POST /api/admin/users              System admin: create user
PATCH /api/admin/users/:id         System admin: update user
GET  /api/admin/users/:id          System admin: get user
DELETE /api/admin/users/:id        System admin: delete user
POST /api/admin/users/:id/invite   System admin: invite user
POST /api/admin/invitations        System admin: create system invitation
GET  /api/admin/tenants            System admin: list tenants
POST /api/admin/tenants            System admin: create tenant
PATCH /api/admin/tenants/:id       System admin: update tenant
DELETE /api/admin/tenants/:id      System admin: delete tenant
GET  /api/admin/tenants/:id        System admin: get tenant
GET  /api/roles                    List roles
POST /api/roles                    Create role
GET  /api/roles/:id                Get role
PUT  /api/roles/:id                Update role
DELETE /api/roles/:id              Delete role
```

### Concerns

1. **Catch-all route**: `@All('*splat')` forwards unmatched `/api/auth/*` requests directly to Better Auth without NestJS-level validation or rate limiting
2. **No rate limiting** on auth endpoints
3. **No API versioning** (acceptable at this stage)
4. **Inconsistent pagination**: `SystemAdminController` handles it, but other list endpoints do not

---

## 7. Authentication/Authorization

### Authentication Flow

```text
Client                    NestJS API                  Better Auth
  |-- POST /auth/login --> |-- api.signInEmail() ----> |
  |                        |<-- Response + Set-Cookie -|
  |                        |-- enrich w/ permissions ->|
  |<-- session + user -----|                           |
  |                        |                           |
  |-- GET /users (cookie)->|-- AuthGuard ------------> |
  |                        |   getSessionFromHeaders   |
  |                        |   getEnrichedSession      |
  |                        |<-- req.user = enriched ---|
  |                        |-- PermissionsGuard ------>|
  |                        |   checks user.permissions |
  |<-- response -----------|                           |
```

### RBAC Model

```text
User --[member]--> Organization
         |
         +-- role (FK to role table)
                |
                +-- role_permission (many) --> permission (resource:action)
```

### Strengths

- Clean decorator-based permission checking (`@RequirePermission('users', 'manage')`)
- Wildcard support (`*` grants all permissions)
- Tenant-scoped permissions

### Weaknesses

1. **N+1 query problem**: Every authenticated request triggers 4-5 database queries via `getEnrichedSession()`. No caching layer exists.
2. **Double session validation in AuthGuard**: Calls `getSessionFromHeaders()` then `getEnrichedSession()`, both independently querying the database.
3. **Inconsistent header handling across guards**: Three different approaches to handling HTTP headers for Better Auth.

---

## 8. Configuration Management

### Required Environment Variables

- `DATABASE_URL`
- `SYSTEM_TENANT_ID`, `OWNER_ROLE_ID`, `ADMIN_ROLE_ID`, `MEMBER_ROLE_ID`
- `BETTER_AUTH_URL`, `ALLOWED_ORIGINS`, `FRONTEND_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (optional)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `MAIL_MOCK` (optional, for dev)
- `VITE_API_URL` (frontend)

### Concerns

1. **No `.env.example`** in repository despite README referencing it
2. **Hardcoded fallback** in `drizzle.config.ts` with different credentials than docker-compose
3. **Docker compose credentials** in plain text (acceptable for local dev only)

---

## 9. Testing Strategy

### Coverage

- `apps/api`: 22 unit/spec tests + 3 e2e tests
- `apps/web`: 3 spec tests
- `packages/identity`: 10 spec tests
- **Total**: 38 test files

### Quality Gate

Pre-commit hook: lint-staged -> full lint -> TypeScript type check -> test with coverage

### Concerns

1. **Weak frontend test coverage**: Only 3 test files for the web app
2. **No integration test database**: E2E tests likely rely on mocks
3. **Coverage threshold not enforced**: README states 60% but no hard threshold in config

---

## 10. Strengths Summary

1. **Hexagonal identity layer** -- Clean interface/adapter separation; swapping providers is genuinely feasible
2. **Clean multi-tenant RBAC** -- Well-designed with proper normalization and atomic operations
3. **Good schema design** -- Soft deletes, partial unique indexes, defensive constraints
4. **Aggressive quality gates** -- Pre-commit hooks run lint + type check + tests
5. **Good documentation discipline** -- Architecture docs + `TECHNICAL_DEBT.md` tracking known issues
6. **Strategy pattern for email** -- Clean switch between real and mock providers
7. **DatabaseManager utility** -- Well-documented with environment safeguards
8. **PII cleanup job** -- Shows security awareness with batch processing and safety limits

---

## 11. Issues and Recommendations

### Critical (Should Fix Soon)

| # | Issue | Recommendation | Effort |
|---|-------|----------------|--------|
| C1 | No permission caching -- 4-5 DB queries per authenticated request | Implement Redis session cache with TTL, invalidate on permission changes | 2-3 days |
| C2 | `BetterAuthAdapter.mapUser()` is a 150-line God Method with 5+ code paths | Extract into dedicated `PermissionResolver` class, standardize on one code path | 1-2 days |
| C3 | Missing `.env.example` | Create with all required variables documented | 1 hour |

### High Priority

| # | Issue | Recommendation | Effort |
|---|-------|----------------|--------|
| H1 | Circular dependency AuthModule <-> InvitationsModule | Remove unnecessary `forwardRef`, move `complete-invite` to dedicated controller | 1 day |
| H2 | Dual auth systems on frontend | Make custom AuthProvider single source of truth, Refine provider delegates to it | 2-3 days |
| H3 | `db: db as any` type cast in app.module.ts | Fix schema type threading between identity package and API | 2-4 hours |
| H4 | Inconsistent header conversion across guards | Standardize on `toWebHeaders()` utility everywhere | 2-4 hours |

### Medium Priority

| # | Issue | Recommendation | Effort |
|---|-------|----------------|--------|
| M1 | Legacy `user.role` coexisting with `member.role` | Create deprecation migration path | 1-2 days |
| M2 | Better Auth catch-all exposes unknown surface | Restrict to known routes only | 1 day |
| M3 | No rate limiting on auth endpoints | Add `@nestjs/throttler` module | 1 day |
| M4 | Email content uses inline HTML strings | Implement proper email templates | 2-3 days |
| M5 | Operational scripts undocumented | Add usage documentation | 0.5 days |

### Low Priority

- Remove unused deps (`class-validator`, `@bufbuild/protobuf`)
- Align `@types/node` versions across packages
- Configure explicit database pool settings

---

## 12. Scalability Considerations

### Current Scale Assessment

Architecture is appropriate for an early-stage B2B product with <1,000 tenants and <10,000 users.

### Scaling Bottlenecks (in order)

1. **Auth query volume** (0-1K users): Per-request permission resolution. Fix with Redis caching.
2. **Database connection pool** (1K-10K users): Default pool of 10 connections will saturate.
3. **Single PostgreSQL** (10K-100K users): Read replicas needed for read-heavy workload.
4. **Tenant data isolation** (100K+ users): Shared-schema model requires careful indexing or schema-per-tenant.
5. **No background job infrastructure**: PII cleanup exists but no scheduler. No queue system (BullMQ) implemented.

### What Scales Well

- Hexagonal architecture allows adapter replacement without touching business logic
- Turborepo caching keeps builds fast as monorepo grows
- RBAC model is normalized and extensible without schema changes
- Multi-tenant model supports adding tenants without infrastructure changes
