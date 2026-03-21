# Code Reviewer Memory - Nexiom

## Project Architecture

- Monorepo: `apps/api` (NestJS), `apps/web` (React/Vite), `packages/identity` (shared identity package)
- ORM: Drizzle ORM with PostgreSQL
- Auth: better-auth library with custom adapters
- RBAC: Database-driven, role -> rolePermission -> permission tables
- Member table holds organization-scoped roles (FK to role table); `user.role` is legacy/deprecated

## Key Patterns

- Adapters: `BetterAuthAdapter` (IAuthProvider), `DrizzleUserAdapter` (IUserProvider), `DrizzleTenantAdapter`, `DrizzleRoleAdapter`
- `mapUser()` in BetterAuthAdapter resolves permissions from member records (async)
- `mapUser()` in DrizzleUserAdapter is synchronous and does NOT resolve permissions (just maps `user.role` directly)
- NestJS DI tokens in `packages/identity/src/constants.ts`
- Role enum: `Role.Owner`, `Role.Admin`, `Role.Member` (lowercase values)
- Schema types exported from `packages/identity/src/schema.ts`

## Code Quality Notes

- Debug `console.log` statements have appeared in production code in adapters -- flag these
- `as any` casts used frequently to work around Drizzle's deep relation type inference
- `DrizzleUserAdapter.findById` delegates to `AuthProvider.findById` for permission resolution
- `findById` in BetterAuthAdapter does NOT eager-load members, causing lazy-fetch fallback every time
- `AuthService.getEnrichedSession` independently resolves permissions via PermissionProvider -- this duplicates/conflicts with mapUser permission resolution
- [project_drizzle_relations_gap.md] appConnections table has NO Drizzle relations() defined -- db.query.appConnections.findMany() is unreliable and leaks all columns

## Test Patterns

- Vitest used for all packages
- Mocks use `vi.fn()` and `vi.mock()`
- Test DB mock is `mkDb()` factory returning chainable query mock

## Schema Notes

- envTypeEnum defined in tenant.ts, re-exported from workspace.ts
- appConnections has envType column (PRODUCTION|SANDBOX default PRODUCTION)
- uiWorkspaces + uiWorkspaceConnections bridge table in workspace.ts
- storeOAuthConnection UPDATE path does not write envType (bug found 2026-03-21)
