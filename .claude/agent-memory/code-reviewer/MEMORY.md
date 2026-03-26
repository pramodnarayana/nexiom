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

- Debug `console.log`/`console.debug` statements have appeared in production code in adapters AND pieces (salesforce/src/index.ts) -- flag these
- `as any` casts used frequently to work around Drizzle's deep relation type inference
- `DrizzleUserAdapter.findById` delegates to `AuthProvider.findById` for permission resolution
- `findById` in BetterAuthAdapter does NOT eager-load members, causing lazy-fetch fallback every time
- `AuthService.getEnrichedSession` independently resolves permissions via PermissionProvider -- this duplicates/conflicts with mapUser permission resolution
- [project_drizzle_relations_gap.md] appConnections table has NO Drizzle relations() defined -- db.query.appConnections.findMany() is unreliable and leaks all columns

## Test Patterns

- Vitest used for all packages
- Mocks use `vi.fn()` and `vi.mock()`
- Test DB mock is `mkDb()` factory returning chainable query mock

## Scheduler / Sync Pipeline

- Abstract `SyncRunner` base class with DI swapping (`{ provide: SyncRunner, useClass: PollSyncRunner }`)
- `PollSyncRunner` implements Singer-style poll with Redis NX locks, crash-resume via `currently_syncing` + `bookmark.offset`
- State persisted in `public.sync_cursors` (stitchId + streamName composite key, JSONB stateDocument)
- `CursorManagerService` in `packages/engine` -- stateless, computes windows + tracks HWM
- Lock key: `lock:poll:${stitchId}:${streamName}`, TTL = `max(syncIntervalMinutes * 2 * 60_000, 5 * 60_000)`ms
- Lock uses Lua-atomic renew/release with owner token verification
- `OAuthCredentialBlob` double-cast to `Record<string, unknown>` is a recurring pattern in piece calls
- Test mock pattern: `makeDb()` with table-aware `.from()` dispatching (improved from callCount)
- OutboxWorkerService: off-by-one risk in retry count vs back-off comment (OW-1 flagged 2026-03-25)
- CursorResetController: TOCTOU race between lock check and cursor delete (CR-1 flagged 2026-03-25)
- HttpWindmillClient.ensureStitchScript: does not update existing scripts on content change (HW-1 flagged 2026-03-25)
- PollSyncRunner always instantiated even when WINDMILL_ENABLED=false (SM-1 flagged 2026-03-25)

## Observability & Webhook Pipeline

- Structured logging: nestjs-pino with pino-pretty (dev) / JSON stdout + Vector sidecar (prod)
- Log injection prevention: x-request-id validated via `/^[a-zA-Z0-9_-]{1,128}$/` regex
- Rate limiting: Lua-script fixed-window per-tenant in Redis (`ratelimit:l1:{tenantId}:{connectionId}`)
- Probe protection: negative cache + fallback buckets for unknown/malformed UUIDs
- Webhook signature: HMAC-SHA256 with timingSafeEqual, per-piece config (secretKeyEnv, signatureHeader, signatureEncoding)
- Header allowlist: only safe headers persisted to inbound_gateway (strips auth/cookie/signature)
Idempotency: 23505 unique_violation on `idx_l1_ext_id` constraint returns 202 (vendor event ID duplicate)
- Tenant schema isolation: `SET LOCAL search_path` with assertValidSchemaName defense-in-depth
- ShutdownService: custom SIGTERM/SIGINT handler with 25s hard deadline, replaces NestJS enableShutdownHooks
- Database: singleton Pool via getDb(), closeDb() called from DatabaseModule.onModuleDestroy
- CORS: origin allowlist from ALLOWED_ORIGINS env var -- intentionally permits requests with no Origin for non-browser clients (webhooks protected by WebhookSignatureGuard) (updated 2026-03-25)
- Vector config: docker_logs source -> remap parse_json -> http sink to OpenObserve (OPENOBSERVE_URL and OPENOBSERVE_TOKEN are hard-required; OPENOBSERVE_ORG and OPENOBSERVE_STREAM default to "nexiom" and "api-logs")

## Schema Notes

- envTypeEnum defined in tenant.ts, re-exported from workspace.ts
- appConnections has envType column (PRODUCTION|SANDBOX default PRODUCTION)
- uiWorkspaces + uiWorkspaceConnections bridge table in workspace.ts
- storeOAuthConnection UPDATE path does not write envType (bug found 2026-03-21)
- TokenManagerService.onModuleDestroy calls redis.quit() on a shared singleton -- potential issue
- MappingCanvas calls onChange (parent setState) inside setCanvas updater -- React anti-pattern (side effects in updater)
- Frontend FieldDescriptor type (metadata.api.ts) diverges from backend Salesforce piece fields
- Stitches metadata uses Redis + DB two-tier cache with 5min TTL; forceRefresh busts both
