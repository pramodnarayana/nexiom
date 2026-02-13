# Nexiom Architecture Memory

## Project Overview

- **Type**: B2B iPaaS (Integration Platform as a Service) - Monorepo
- **Stage**: Early-stage product, focused on Identity/Auth foundation
- **Branch model**: Trunk-based development, feature branches -> `development` -> `master`

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces (pnpm 10.27, Node 20)
- **Backend**: NestJS 11, TypeScript, Drizzle ORM, PostgreSQL 15, Better Auth
- **Frontend**: React 19, Vite 5, Tailwind CSS 3.4, Refine (admin framework), React Router 7
- **Auth**: Better Auth (self-hosted) with session cookies, RBAC via custom RBAC tables
- **Email**: Nodemailer (prod) / ConsoleEmailService (dev) - Strategy pattern
- **Testing**: Vitest + supertest (e2e), 60% coverage threshold enforced
- **CI**: GitHub Actions (lint + test:cov + build)

## Key Architecture Patterns

- **Ports & Adapters (Hexagonal)** in `packages/identity`: interfaces define ports, Drizzle adapters implement them
- **Provider pattern** via NestJS DI: AUTH_PROVIDER, USER_PROVIDER, TENANT_PROVIDER, PERMISSION_PROVIDER, ROLE_PROVIDER, EMAIL_PROVIDER
- **Multi-tenant RBAC**: Organization-scoped roles via member.role FK to role table, permissions resolved via role_permission join
- **Dynamic Module** pattern: `IdentityModule.registerAsync()` for configurable identity subsystem

## Directory Structure

```text
apps/api/          - NestJS backend (modules/identity/{auth,users,tenants,invitations,system-admin,roles})
apps/web/          - React frontend (modules/{identity,dashboard,tenants,marketing}, shared/{components,lib,contexts})
packages/identity/ - Shared identity library (adapters, interfaces, schema, services, utils)
scripts/           - Operational scripts (cleanup, debug, fix)
docs/              - Architecture docs, drafts, refactor plans
```

## Critical Files

- Schema (single source): `packages/identity/src/schema.ts`
- API schema re-export: `apps/api/src/db/schema.ts`
- Module wiring: `apps/api/src/app/app.module.ts`
- Identity DI module: `packages/identity/src/identity.module.ts`
- Auth adapter (Better Auth): `packages/identity/src/adapters/better-auth.adapter.ts`
- Constants/permissions: `packages/identity/src/constants.ts`

## Known Issues

- Permission caching absent on frontend (TECHNICAL_DEBT.md)
- `forwardRef` circular deps between AuthModule <-> InvitationsModule
- Legacy `user.role` field coexists with authoritative `member.role` FK
- `db: db as any` cast in app.module.ts IdentityModule registration
- `BetterAuthAdapter.mapUser()` has complex permission resolution with multiple fallback paths
