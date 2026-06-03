# Pipeline L3–L6 Enterprise Implementation Plan

Branch: `feat/pipeline-l3-l4-l5-l6`

## Key Discoveries Since v1

| Item | Finding |
|---|---|
| `global_entity_map` schema | ✅ Already exists in `packages/database/src/schema/gem.ts` — fully defined with unique index. **Do not recreate.** |
| `appConnections` Drizzle table | ✅ Defined in `packages/database/src/schema/tenant.ts` as `appConnections` — `appName` column is `app_connection.app_name`. Use this instead of raw SQL. |
| `RetryableException` | ❌ Does not exist anywhere. Must create. |
| `sanitizeError` | 📍 Exists only in `apps/api/src/modules/scheduler/outbox-worker.service.ts` as a module-private function. Must extract to shared location. |
| PinoLogger in worker | ❌ No PinoLogger usage in `apps/worker` — all services use NestJS `Logger`. Worker has no `nestjs-pino` setup. Keep `Logger` for now, add TODO comments — full PinoLogger migration belongs in a separate observability task. |
| GEM `srcVendorId` flow | `replica_entity.sourceId` exists but is NOT in any queue message. Must thread through `outboundOutbox.payload` from FanOutService. |
| `piece.normalize` interface | ✅ Already defined in `piece.ts` with full JSDoc. Salesforce + QuickBooks stubs needed. |
| Poison pill / ack contract | The `QueueService.consume` callback: if handler throws, SQS re-delivers after visibility timeout. This is the intended contract — no explicit nack needed. Document it. |

---

## Components (Ordered by Dependency)

---

### Component 0 — Shared Utilities

These must land first — all pipeline services depend on them.

#### [NEW] `packages/connectors/src/framework/retryable-exception.ts`

```typescript
/**
 * Thrown by piece.executeAction() implementations to signal a transient
 * vendor-side failure (e.g. 429 Too Many Requests, 503 Service Unavailable).
 *
 * DeliveryService catches this to set outbound_gateway status → 'RETRY'
 * instead of 'FAIL', preserving the delivery outbox row for re-attempt.
 * Non-retryable errors (4xx permanent, bad payload) should NOT use this.
 */
export class RetryableException extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'RetryableException';
  }
}
```

Export from `packages/connectors/src/framework/index.ts` and root `packages/connectors/src/index.ts`.

#### [NEW] `apps/worker/src/shared/pipeline.utils.ts`

Extract and harden `sanitizeError` as a shared pipeline utility:

```typescript
/**
 * Returns a log/DB-safe version of an error message.
 * - Strips URL credentials (https://user:token@host → https://[REDACTED]@host)
 * - Truncates to 500 characters (matches last_error column length)
 */
export function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const stripped = msg.replaceAll(/\/\/[^@\s]*@/g, '//[REDACTED]@');
  return stripped.length > 500 ? `${stripped.slice(0, 500)}…` : stripped;
}

/**
 * Classifies an HTTP status code as retryable (transient) or permanent.
 * Retryable: 429 (rate limit), 502 (bad gateway), 503 (unavailable), 504 (timeout).
 * All other non-2xx codes are permanent failures.
 */
export const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

export function isRetryableStatusCode(statusCode: number): boolean {
  return RETRYABLE_STATUS_CODES.has(statusCode);
}
```

---

### Component 1 — T028: Piece Stubs (Salesforce + QuickBooks)

The `Piece` interface already has `normalize`, `executeAction`, `poll`, `describeStreams` fully defined. Only stub implementations are needed.

#### [MODIFY] `packages/pieces/salesforce/src/index.ts`

Add to `createPiece(...)`:

```typescript
async normalize(_objectType: string, _raw: Record<string, unknown>) {
  // Returns null — Salesforce records are stored as-is in L2 (RAW pass-through).
  // Field mapping to canonical model happens via field_mapping rules in L4.
  // NormalizationService falls back to canonicalType='RAW' when null is returned.
  return null;
},

async executeAction(
  objectType: string,
  payload: Record<string, unknown>,
  credentials: Record<string, unknown>,
) {
  const instanceUrl = (credentials['instance_url'] as string | undefined) ?? 'http://localhost:4010';
  const res = await fetch(`${instanceUrl}/services/data/v59.0/sobjects/${objectType}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credentials['access_token'] as string ?? 'stub'}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000), // 15s — matches T028 implementation
  });
  const body = await res.json() as Record<string, unknown>;
  return { statusCode: res.status, body };
},
```

#### [MODIFY] `packages/pieces/quickbooks/src/index.ts`

Same pattern, adapted for QuickBooks:

```typescript
async normalize(_objectType: string, _raw: Record<string, unknown>) {
  // Returns null — RAW pass-through (see Salesforce note above).
  return null;
},

async executeAction(objectType: string, payload: Record<string, unknown>, credentials: Record<string, unknown>) {
  const baseUrl = (credentials['base_url'] as string | undefined) ?? 'http://localhost:4011';
  const companyId = (credentials['realm_id'] as string | undefined) ?? 'stub';
  const res = await fetch(`${baseUrl}/v3/company/${companyId}/${objectType.toLowerCase()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${credentials['access_token'] as string ?? 'stub'}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000), // 15s — matches T028 implementation
  });
  const body = await res.json() as Record<string, unknown>;
  return { statusCode: res.status, body };
},
```

---

### Component 2 — T032: NormalizationService Enterprise Hardening

#### [MODIFY] `apps/worker/src/modules/pipeline/normalization.service.ts`

**Changes:**

1. **Replace raw `app_connection` query** with typed `appConnections` Drizzle query:

   ```typescript
   import { appConnections } from '@soopa/database';
   // ...
   const connRows = await this.db
     .select({ appName: appConnections.appName })
     .from(appConnections)
     .where(eq(appConnections.id, connectionId))
     .limit(1);
   ```

2. **Message validation** — guard at top of `processMessage`:

   ```typescript
   if (!traceId || typeof traceId !== 'string' || !connectionId || typeof connectionId !== 'string') {
     this.logger.warn({ event: 'l3.invalid_message', msg: rawMsg },
       'L3: dropping invalid message — missing traceId or connectionId');
     return; // ACK — do not rethrow, prevents poison-pill loop
   }
   ```

3. **Use `sanitizeError`** from shared utils for all `lastError` fields and log fields.

4. **`syncLog` FAIL insert in error path** — already has `onConflictDoNothing` ✅. Verify `durationMs` field is still computed correctly in catch block.

5. **Add structured context to all log calls**: every log must include `{ event, traceId, connectionId, layer: 'L3' }`.

#### [MODIFY] `apps/worker/src/modules/pipeline/normalization.service.spec.ts`

Add three new test cases:
- `invalid message (missing traceId)` — assert returns without throwing, no DB calls
- `piece.normalize returns null` — `normalizedEntity` inserted with `canonicalType: 'RAW'`
- `piece.normalize throws` — FAIL `sync_log` written, error rethrown

---

### Component 3 — T033: FanOutService Enterprise Hardening

#### [MODIFY] `apps/worker/src/modules/pipeline/fanout.service.ts`

**Changes:**

1. **Replace raw `app_connection` query** — not present here (L4 doesn't resolve piece), but ensure `integrationStitches` queries use typed Drizzle columns, not `sql\`\``.

2. **`writeSyncLog` idempotency** — add `onConflictDoNothing({ target: [syncLog.traceId, syncLog.routeId, syncLog.layer, syncLog.status] })` to the helper. This requires `routeId` to already be in the signature (it is).

3. **Inline SUCCESS `syncLog` insert** — also needs `onConflictDoNothing` with the same 4-column target.

4. **Change stitch loop from `for...of` to `processInChunks`**:

   ```typescript
   import { processInChunks } from './outbox.utils.js';
   // ...
   await processInChunks(stitches, 5, (stitch) => this.processSingleStitch(schemaName, traceId, connectionId, normalizedData, canonicalType, stitch, start));
   ```

   Extract the per-stitch logic into a private `processSingleStitch()` method.

5. **Message validation** — same guard as L3.

6. **`normalizedData` typed as `Record<string, unknown>`** — remove the `any` and the `eslint-disable` for this.

7. **Thread `srcVendorId` through `outboundOutbox.payload`**:
   - When reading `normalizedEntity`, also read `replicaEntity.sourceId` via JOIN or secondary query
   - Add `srcVendorId: replicaEntity.sourceId` to `outboundOutbox.payload`
   - Add `srcConnectionId: connectionId` and `destConnectionId: stitch.destConnectionId` to payload (needed by L6 for GEM write)

   Full delivery outbox payload shape:

   ```typescript
   {
     traceId,
     connectionId,          // src connection
     targetConnectionId: stitch.destConnectionId,
     routeId: stitch.id,
     outboundGatewayId: outbound.id,
     srcVendorId: replica.sourceId,      // NEW: for GEM L6 write
     canonicalType,                       // NEW: for GEM entity type field
   }
   ```

8. **DLQ notification on permanent stitch failure**: when `writeSyncLog(FAIL)` is called after a stitch error, additionally log `{ event: 'l4.permanent_fail', stitchId, traceId }` at ERROR level with enough context for the Exception Center query to surface it.

#### [MODIFY] `apps/worker/src/modules/pipeline/fanout.service.spec.ts`

- Replace brittle `toHaveBeenCalledTimes(4)` tx-count assertion with behavioral assertions (e.g. `syncLog insert was called with status: 'FAIL'`)
- Add: **`writeSyncLog` is idempotent** — `onConflictDoNothing` called on syncLog insert
- Add: **invalid message returns early without throwing**
- Add: **`srcVendorId` is present in outboundOutbox payload**

---

### Component 4 — T034: DeliveryService Enterprise Hardening

#### [MODIFY] `apps/worker/src/modules/pipeline/delivery.service.ts`

**Changes:**

1. **Replace raw `app_connection` query** with typed `appConnections`:

   ```typescript
   import { appConnections, safeAppConnectionColumns } from '@soopa/database';
   // ...
   const connRows = await this.db
     .select({ appName: appConnections.appName })
     .from(appConnections)
     .where(eq(appConnections.id, targetConnectionId))
     .limit(1);
   ```

2. **Message validation** — validate `traceId`, `connectionId`, `targetConnectionId`, `routeId`, `outboundGatewayId` at start.

3. **`MAX_ATTEMPTS` guard** — read `attemptCount` from `outbound_gateway` row when fetching `reqPayload`. Before calling `executeAction`, check:

   ```typescript
   const MAX_DELIVERY_ATTEMPTS = 5;
   if (ob[0].attemptCount >= MAX_DELIVERY_ATTEMPTS) {
     // Mark FAIL without calling piece — max attempts exhausted at L5
     await this.db.transaction(async (tx) => { ... set status: 'FAIL' ... });
     this.logger.error({ event: 'l5.max_attempts', outboundGatewayId, traceId }, 'Max delivery attempts exceeded');
     return;
   }
   ```

4. **Retry classification — `RetryableException` takes priority over status code heuristics**:

   ```typescript
   import { RetryableException } from '@soopa/connectors';
   import { isRetryableStatusCode, sanitizeError } from '../../shared/pipeline.utils.js';

   // When piece RETURNS a response (success branch):
   // isRetryableStatusCode is safe here — the piece explicitly returned this status.
   if (isRetryableStatusCode(statusCode)) { finalStatus = 'RETRY'; }

   // When piece THROWS (catch branch):
   // Only retry if the piece opts-in via RetryableException or retryable:true flag.
   // Do NOT retry plain thrown 5xx — we cannot tell if the operation completed.
   if (error_ instanceof RetryableException) {
     finalStatus = 'RETRY';
   } else if (errObj['retryable'] === true) {
     finalStatus = 'RETRY';
   } else {
     finalStatus = 'FAIL';
   }
   ```

   In L6 transaction: if `finalStatus === 'RETRY'`, set `outbound_gateway.status = 'RETRY'` (not `FAIL`), set `sync_log { layer: 'L5', status: 'RETRY' }`.

5. **Use `sanitizeError`** from shared utils for all error message logging and DB persistence.

6. **`syncLog` L5 write** — the current code only writes `sync_log { layer: 'L6' }` on success or failure. Add `sync_log { layer: 'L5', status: 'PROCESSING' }` at claim time and update it to SUCCESS/FAIL/RETRY in the L6 transaction. (Matches the L1–L4 pattern of one sync_log row per layer per outcome.)

7. **L6 GEM write** — in the SUCCESS branch of the L6 transaction:

   ```typescript
   import { globalEntityMap } from '@soopa/database';

   const srcVendorId = msg.srcVendorId as string | undefined;
   const destVendorId = extractDestVendorId(resPayload); // see below

   if (srcVendorId && destVendorId) {
     await tx.insert(globalEntityMap).values({
       stitchId: routeId,
       sourceAppName: srcAppName,
       sourceAppId: connectionId,
       sourceOrgId: srcTenantId,
       sourceEntityType: msg.canonicalType as string ?? 'UNKNOWN',
       sourceEntityId: srcVendorId,
       sourceRefLayer: 'L2',
       sourceTraceId: traceId,
       destAppName: targetAppName,
       destAppId: targetConnectionId,
       destOrgId: targetTenantId,
       destEntityType: msg.canonicalType as string ?? 'UNKNOWN',
       destEntityId: destVendorId,
       destRefLayer: 'L6',
       destTraceId: traceId,
     }).onConflictDoUpdate({
       target: [globalEntityMap.stitchId, globalEntityMap.sourceAppId,
                globalEntityMap.sourceEntityId, globalEntityMap.destAppId,
                globalEntityMap.destEntityType],
       set: { destEntityId: destVendorId, lastSyncedAt: sql`NOW()` },
     });
   }
   ```

   `extractDestVendorId(body)` helper:

   ```typescript
   function extractDestVendorId(body: unknown): string | undefined {
     if (typeof body !== 'object' || body === null) return undefined;
     const b = body as Record<string, unknown>;
     // Common vendor ID field names: Salesforce uses 'id', QuickBooks uses 'Id'
     const raw = b['id'] ?? b['Id'] ?? 
                 (b['result'] as Record<string, unknown> | undefined)?.['id'] ?? 
                 (b['data'] as Record<string, unknown> | undefined)?.['id'];
     return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
   }
   ```

8. **`orgId` gap** — `sourceOrgId`/`destOrgId` are required by the GEM schema (`notNull()`). For now, thread `connectionId` → look up `tenantId` from `appConnections` (already fetched) and use it. Update the GEM values to pass real `tenantId` as `*OrgId`.

#### [MODIFY] `apps/worker/src/modules/pipeline/delivery.service.spec.ts`

Add:
- `429 response → RETRY on outboundGateway`
- `503 response → RETRY`
- `4xx non-429 → FAIL`
- `piece throws RetryableException → RETRY`
- `MAX_ATTEMPTS exceeded → FAIL without calling executeAction`
- `GEM row inserted on SUCCESS`
- `GEM insert is idempotent (onConflictDoUpdate)`

---

## Verification Plan

```bash
# 1. Build (confirms types)
pnpm build

# 2. Worker tests + coverage
pnpm --filter worker test:cov

# 3. Connectors package tests (piece stubs)
pnpm --filter @soopa/connectors test

# 4. Lint
pnpm lint
```

### Critical test scenarios

| Scenario | Layer | Expected Outcome |
|---|---|---|
| Invalid queue message (missing traceId) | L3/L4/L5 | ACK, return early, no DB writes |
| `piece.normalize` returns null | L3 | `canonicalType: 'RAW'`, record stored |
| `piece.normalize` throws | L3 | FAIL sync_log, error rethrown |
| Sync condition mismatch | L4 | SKIPPED sync_log (idempotent) |
| Crash after outboundGateway insert, before outboundOutbox | L4 | Re-run is idempotent (onConflictDoUpdate) |
| `RetryableException` from piece | L5 | `RETRY` on outbound_gateway |
| 429 status code | L5 | `RETRY` on outbound_gateway |
| 422 status code | L5 | `FAIL` on outbound_gateway |
| `MAX_ATTEMPTS >= 5` | L5 | `FAIL`, no executeAction call |
| Successful delivery with vendor ID | L6 | GEM row upserted |
| Same delivery replayed | L6 | GEM `onConflictDoUpdate` updates `lastSyncedAt` |

---

## File Manifest

| Action | File |
|---|---|
| NEW | `packages/connectors/src/framework/retryable-exception.ts` |
| MODIFY | `packages/connectors/src/framework/index.ts` — export RetryableException |
| MODIFY | `packages/connectors/src/index.ts` — re-export RetryableException |
| NEW | `apps/worker/src/shared/pipeline.utils.ts` |
| MODIFY | `packages/pieces/salesforce/src/index.ts` — add normalize + executeAction |
| MODIFY | `packages/pieces/quickbooks/src/index.ts` — add normalize + executeAction |
| MODIFY | `apps/worker/src/modules/pipeline/normalization.service.ts` |
| MODIFY | `apps/worker/src/modules/pipeline/normalization.service.spec.ts` |
| MODIFY | `apps/worker/src/modules/pipeline/fanout.service.ts` |
| MODIFY | `apps/worker/src/modules/pipeline/fanout.service.spec.ts` |
| MODIFY | `apps/worker/src/modules/pipeline/delivery.service.ts` |
| MODIFY | `apps/worker/src/modules/pipeline/delivery.service.spec.ts` |
