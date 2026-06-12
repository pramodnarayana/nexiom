---
name: Codebase patterns and conventions
description: Key architectural patterns, error handling conventions, and testing patterns in the Soopa monorepo
type: project
---

## Error Handling
- PG errors are extracted via `extractPgError` in `apps/api/src/shared/db.utils.ts` (checks err.code then err.cause.code)
- `isUniqueViolation` wraps extractPgError for the common 23505 check
- Drizzle wraps pg errors on `.cause` — current extraction only goes 1 level deep

## OAuth Token Management
- `TokenManagerService` in `packages/connectors/src/oauth/token-manager.service.ts` handles refresh with Redis distributed locking
- `OAuthRefreshError` with `.status` field controls REVOKED marking in `handleRefreshError`
- Only status 400/401 triggers REVOKED — missing status means connection stays in limbo

## Metadata Discovery
- Multi-layer cache: Redis → DB (connectorObjectProfiles) → live piece fetch
- TTL is 5 minutes across both layers
- `forceRefresh` busts Redis and skips DB cache

## Frontend Patterns
- React pages use load-token refs (e.g., `loadIdRef`) to prevent stale async state updates
- API client modules are in `modules/*/api/*.api.ts`
- Validation files use `.validation.ts` suffix (never `.dto.ts`)
- UI components use Radix primitives + Tailwind

## Testing
- Vitest + @nestjs/testing for backend service specs
- Mock DB is built with `buildMockDb()` factory pattern returning chainable mock objects
- Transaction mocks execute callbacks synchronously with shared tx mock

## Naming
- Never use "dto" in param names or file suffixes — use "body" and ".validation.ts"
- Always use pnpm (never npm/npx/yarn)

**Why:** These conventions were confirmed across multiple files in the codebase during the March 2026 review.

**How to apply:** Reference these patterns when reviewing new code for consistency.
