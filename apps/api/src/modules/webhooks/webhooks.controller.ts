import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  DATABASE_CONNECTION,
  buildTenantSchema,
  assertValidSchemaName,
} from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { StorageResolverService } from '../storage-resolver/storage-resolver.service.js';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';
import { TenantRateLimitGuard } from '../../guards/tenant-rate-limit.guard.js';

/** PostgreSQL unique_violation error code. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Unique constraint names that indicate an idempotency collision on the
 * inbound_gateway table. Only these violations are silently swallowed as 202.
 *
 * - idx_l1_ext_id   : uniqueIndex(connectionId, ext_req_id) — vendor event ID duplicate
 * - inbound_gateway_trace_id_unique : inline unique on trace_id — our own UUID dedup
 */
const IDEMPOTENCY_CONSTRAINTS = new Set([
  'idx_l1_ext_id',
  'inbound_gateway_trace_id_unique',
]);

/**
 * Headers stored alongside the payload for audit / debugging purposes.
 * All other headers (including Authorization, Cookie, and signature headers)
 * are stripped before persistence to avoid accidentally leaking credentials.
 */
const STORED_HEADER_ALLOWLIST = new Set([
  'content-type',
  'user-agent',
  'x-request-id',
  'x-webhook-id',
  'x-event-id',
  'x-forwarded-for',
]);

@Controller('webhooks')
export class WebhooksController {
  constructor(
    @InjectPinoLogger(WebhooksController.name)
    private readonly logger: PinoLogger,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
  ) {}

  /**
   * POST /webhooks/:connectionId
   *
   * Accepts an incoming webhook payload and writes it as an immutable
   * LAYER 1 (inbound_gateway) record in the connection's tenant schema.
   *
   * Returns 202 Accepted:
   *   - On successful insert.
   *   - On PgError 23505 for a known idempotency constraint — the event was
   *     already received; returning 202 prevents the vendor from retrying.
   *
   * Optional headers used for vendor idempotency:
   *   x-webhook-id  -- Salesforce / generic event ID
   *   x-event-id    -- QuickBooks event ID
   */
  @Post(':connectionId')
  @UseGuards(TenantRateLimitGuard, WebhookSignatureGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async ingest(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string>,
  ): Promise<void> {
    const start = Date.now();
    const schemaName =
      await this.storageResolver.resolveSchemaName(connectionId);
    const { inboundGateway } = buildTenantSchema(schemaName);
    const traceId = randomUUID();
    const extReqId = headers['x-webhook-id'] ?? headers['x-event-id'];

    // Bind L1-specific fields so every log call in this method carries them.
    this.logger.assign({ layer: 'L1', traceId, extReqId });

    // Strip sensitive / irrelevant headers before persisting. Only the keys
    // in STORED_HEADER_ALLOWLIST are written to inbound_gateway.headers.
    const filteredHeaders = Object.fromEntries(
      Object.entries(headers).filter(([k]) =>
        STORED_HEADER_ALLOWLIST.has(k.toLowerCase()),
      ),
    );

    try {
      await this.db.transaction(async (tx) => {
        // assertValidSchemaName is already called inside buildTenantSchema above,
        // but we call it again here as an explicit defence-in-depth guard directly
        // adjacent to the sql.raw() usage, so a future refactor cannot silently
        // break the safety invariant.
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw(`"${schemaName}"`)}`,
        );
        await tx.insert(inboundGateway).values({
          traceId,
          connectionId,
          payload: body as Record<string, unknown>,
          headers: filteredHeaders,
          extReqId,
        });
      });
      const durationMs = Date.now() - start;
      this.logger.assign({ durationMs });
      this.logger.debug({ event: 'l1.ingested' }, 'L1 ingested');
    } catch (err: unknown) {
      // Only swallow 23505 errors that come from known idempotency constraints.
      // Any other unique violation (e.g. a bug in downstream schema) must surface.
      if (isPgIdempotencyViolation(err)) {
        this.logger.debug(
          { event: 'l1.duplicate' },
          'Duplicate webhook ignored (idempotency)',
        );
        return;
      }
      this.logger.error(
        {
          event: 'l1.error',
          durationMs: Date.now() - start,
          err: err instanceof Error ? err.message : String(err),
        },
        'L1 ingest failed',
      );
      throw err;
    }
  }
}

function isPgIdempotencyViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  if (e['code'] !== PG_UNIQUE_VIOLATION) return false;

  // Primary check: match by constraint name (most reliable — unambiguous).
  if (
    typeof e['constraint'] === 'string' &&
    IDEMPOTENCY_CONSTRAINTS.has(e['constraint'])
  ) {
    return true;
  }

  // Fallback: pg detail text contains the idempotency column name.
  // Covers drivers that don't populate the constraint field.
  if (
    typeof e['detail'] === 'string' &&
    (e['detail'].includes('ext_req_id') || e['detail'].includes('trace_id'))
  ) {
    return true;
  }

  return false;
}
