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
import { QueueService, QueueName } from '@nexiom/queue';
import { StorageResolverService } from '@nexiom/engine';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';
import { TenantRateLimitGuard } from '../../guards/tenant-rate-limit.guard.js';

/** PostgreSQL unique_violation error code. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Unique constraint names that indicate an idempotency collision on the
 * inbound_gateway table. Only these violations are silently swallowed as 202.
 *
 * - idx_l1_ext_id   : uniqueIndex(connectionId, ext_req_id) — vendor event ID duplicate
 */
const IDEMPOTENCY_CONSTRAINTS = new Set(['idx_l1_ext_id']);

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
    private readonly queueService: QueueService,
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

    try {
      const schemaName =
        await this.storageResolver.resolveSchemaName(connectionId);
      const { inboundGateway } = buildTenantSchema(schemaName);
      const inboundGatewayId = randomUUID();
      const extReqId = headers['x-webhook-id'] ?? headers['x-event-id'];

      // Bind L1-specific fields so every log call in this method carries them.
      this.logger.assign({ layer: 'L1', inboundGatewayId, extReqId });

      // Strip sensitive / irrelevant headers before persisting. Only the keys
      // in STORED_HEADER_ALLOWLIST are written to inbound_gateway.headers.
      const filteredHeaders = Object.fromEntries(
        Object.entries(headers).filter(([k]) =>
          STORED_HEADER_ALLOWLIST.has(k.toLowerCase()),
        ),
      );

      await this.db.transaction(async (tx) => {
        // assertValidSchemaName is already called inside buildTenantSchema above,
        // but we call it again here as an explicit defence-in-depth guard directly
        // adjacent to the sql.raw() usage, so a future refactor cannot silently
        // break the safety invariant.
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );
        await tx.insert(inboundGateway).values({
          traceId: inboundGatewayId,
          connectionId,
          payload: body as Record<string, unknown>,
          headers: filteredHeaders,
          extReqId,
        });
      });
      // Await queue delivery to ensure durability.
      // Enqueue failures do NOT abort the 202 response; instead we mark the
      // inbound_gateway record as PENDING so the worker can pick it up on its
      // next poll cycle.
      const traceId = inboundGatewayId;
      await this.queueService
        .send(QueueName.InboundQueue, { traceId, connectionId })
        .catch(async (err: unknown) => {
          this.logger.warn(
            {
              event: 'l1.enqueue_failed',
              traceId,
              err: err instanceof Error ? err.message : String(err),
            },
            'Failed to enqueue L1 event — delivery will be delayed until retry',
          );

          // Mark the record PENDING so the worker retry poll can pick it up.
          // We swallow any DB error here: failing to update the status should
          // not prevent the controller from returning 202, since the record was
          // already durably written in the first transaction above.
          try {
            await this.db.transaction(async (tx) => {
              assertValidSchemaName(schemaName);
              await tx.execute(
                sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
              );
              await tx
                .update(inboundGateway)
                .set({ status: 'PENDING' })
                .where(sql`${inboundGateway.traceId} = ${traceId}`);
            });
          } catch (dbErr: unknown) {
            this.logger.error(
              {
                event: 'l1.pending_update_failed',
                traceId,
                schemaName,
                err: dbErr instanceof Error ? dbErr.message : String(dbErr),
              },
              'Failed to mark inbound_gateway as PENDING after enqueue failure',
            );
            // Do not rethrow — the record is durable; status update is best-effort.
          }
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

        try {
          const schemaName =
            await this.storageResolver.resolveSchemaName(connectionId);
          const { inboundGateway } = buildTenantSchema(schemaName);
          const extReqId = headers['x-webhook-id'] ?? headers['x-event-id'];

          if (extReqId) {
            let existingTraceIdOutside: string | null = null;
            await this.db.transaction(async (tx) => {
              assertValidSchemaName(schemaName);
              await tx.execute(
                sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
              );

              const rows = await tx
                .select({ traceId: inboundGateway.traceId })
                .from(inboundGateway)
                .where(
                  sql`${inboundGateway.extReqId} = ${extReqId} AND ${inboundGateway.connectionId} = ${connectionId}`,
                )
                .limit(1);

              if (rows.length > 0) {
                existingTraceIdOutside = rows[0].traceId;
              }
            });

            if (existingTraceIdOutside) {
              this.logger.debug(
                { event: 'l1.re-enqueue', traceId: existingTraceIdOutside },
                'Attempting to re-enqueue duplicate webhook',
              );
              await this.queueService
                .send(QueueName.InboundQueue, {
                  traceId: existingTraceIdOutside,
                  connectionId,
                })
                .catch(() => {});
            }
          }
        } catch (error_: unknown) {
          this.logger.error(
            { err: error_ instanceof Error ? error_.message : String(error_) },
            'Failed to lookup and re-enqueue duplicate webhook',
          );
        }

        return;
      }
      this.logger.error(
        {
          event: 'l1.error',
          durationMs: Date.now() - start,
          err,
          errMessage: err instanceof Error ? err.message : String(err),
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
  if (typeof e['detail'] === 'string' && e['detail'].includes('ext_req_id')) {
    return true;
  }

  return false;
}
