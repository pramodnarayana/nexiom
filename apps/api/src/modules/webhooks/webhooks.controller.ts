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
  Req,
  Res,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { executeAppWebhookResponses } from '@nexiom/piece-framework';
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
import { DB_MANAGER, type TenantDatabaseManager } from '@nexiom/dbmanager';
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
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: TenantDatabaseManager,
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
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const start = Date.now();

    // Declare appResponseBody at function scope so it's accessible in catch block
    let appResponseBody: unknown;

    try {
      const { schemaName, tenantId } =
        await this.storageResolver.resolveStorageProfile(connectionId);
      const { inboundGateway, inboundOutbox } = buildTenantSchema(schemaName);
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

      // Normalise the inbound payload:
      //   - JSON body → stored as-is (parsed object or array)
      //   - Non-JSON (XML, form-data, text) → wrapped so the raw bytes are
      //     never lost; the normalizer can detect contentType and parse downstream.
      //   - Missing body → empty object sentinel (prevents NOT NULL violation)
      const contentType = headers['content-type'] ?? '';

      let normalizedPayload: Record<string, unknown>;

      if (typeof body === 'string') {
        normalizedPayload =
          body.trim().length > 0 ? { raw: body, contentType } : {};
        appResponseBody = normalizedPayload;
      } else if (
        !contentType.toLowerCase().includes('json') &&
        req.rawBody &&
        req.rawBody.length > 0
      ) {
        // For XML or other non-JSON types, prioritize rawBody.
        // NestJS defaults unparsed bodies to {}, which would otherwise incorrectly evaluate as a parsed JSON object.
        normalizedPayload = { raw: req.rawBody.toString('utf-8'), contentType };
        appResponseBody = normalizedPayload;
      } else if (body != null && typeof body === 'object') {
        // Accept both objects and arrays as parsed payloads
        if (Array.isArray(body)) {
          normalizedPayload = { items: body };
          appResponseBody = normalizedPayload;
        } else {
          normalizedPayload = body as Record<string, unknown>;
          appResponseBody = body;
        }
      } else if (req.rawBody && req.rawBody.length > 0) {
        normalizedPayload = { raw: req.rawBody.toString('utf-8'), contentType };
        appResponseBody = normalizedPayload;
      } else {
        normalizedPayload = {};
        appResponseBody = {};
      }

      const tenantDb = await this.dbManager.getTenantDb(tenantId);
      await tenantDb.transaction(async (tx) => {
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
          request: normalizedPayload,
          headers: filteredHeaders,
          extReqId,
        });

        await tx
          .insert(inboundOutbox)
          .values({
            traceId: inboundGatewayId,
            connectionId,
            status: 'PENDING',
          })
          .onConflictDoNothing({
            target: [inboundOutbox.traceId, inboundOutbox.connectionId],
          });
      });
      // Await queue delivery to ensure durability.
      // Enqueue failures do NOT abort the 202 response; instead we mark the
      // inbound_gateway record as PENDING so the worker can pick it up on its
      // next poll cycle.
      const traceId = inboundGatewayId;
      await this.queueService
        .send(QueueName.InboundQueue, { traceId, connectionId })
        .catch((err: unknown) => {
          this.logger.error(
            {
              event: 'l1.enqueue_failed',
              traceId,
              err: err instanceof Error ? err.message : String(err),
            },
            'Failed to enqueue L1 event — rejecting webhook',
          );
          throw err;
        });

      const durationMs = Date.now() - start;
      this.logger.assign({ durationMs });
      this.logger.debug({ event: 'l1.ingested' }, 'L1 ingested');

      const customResponse = executeAppWebhookResponses(
        appResponseBody,
        headers,
      );
      if (customResponse) {
        this.logger.debug(
          {
            event: 'l1.app_response',
            contentType: customResponse.contentType,
            status: customResponse.status,
          },
          'Returning app-defined synchronous response',
        );
        // Persist the response so support teams can see what was sent back.
        const tenantDb = await this.dbManager.getTenantDb(tenantId);
        await tenantDb.transaction(async (tx) => {
          assertValidSchemaName(schemaName);
          await tx.execute(
            sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
          );
          await tx
            .update(inboundGateway)
            .set({
              response: {
                status: customResponse.status,
                contentType: customResponse.contentType,
                body: customResponse.body,
              },
            })
            .where(sql`${inboundGateway.traceId} = ${inboundGatewayId}`);
        });
        res
          .status(customResponse.status)
          .set('Content-Type', customResponse.contentType)
          .send(customResponse.body);
        return;
      }
      return;
    } catch (err: unknown) {
      // Only swallow 23505 errors that come from known idempotency constraints.
      // Any other unique violation (e.g. a bug in downstream schema) must surface.
      if (isPgIdempotencyViolation(err)) {
        this.logger.debug(
          { event: 'l1.duplicate' },
          'Duplicate webhook ignored (idempotency)',
        );

        try {
          const { schemaName, tenantId } =
            await this.storageResolver.resolveStorageProfile(connectionId);
          const { inboundGateway } = buildTenantSchema(schemaName);
          const extReqId = headers['x-webhook-id'] ?? headers['x-event-id'];

          if (extReqId) {
            let existingTraceIdOutside: string | null = null;
            let existingRecord: {
              traceId: string;
              response: unknown;
            } | null = null;

            const tenantDb = await this.dbManager.getTenantDb(tenantId);
            await tenantDb.transaction(async (tx) => {
              assertValidSchemaName(schemaName);
              await tx.execute(
                sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
              );

              const rows = await tx
                .select({
                  traceId: inboundGateway.traceId,
                  response: inboundGateway.response,
                })
                .from(inboundGateway)
                .where(
                  sql`${inboundGateway.extReqId} = ${extReqId} AND ${inboundGateway.connectionId} = ${connectionId}`,
                )
                .limit(1);

              if (rows.length > 0) {
                existingTraceIdOutside = rows[0].traceId;
                existingRecord = rows[0];
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
                .catch((err: unknown) => {
                  this.logger.error(
                    { err: err instanceof Error ? err.message : String(err) },
                    'Failed to lookup and re-enqueue duplicate webhook',
                  );
                  throw err;
                });

              // If the existing record has no response and we can generate one, persist it
              const customResponse = executeAppWebhookResponses(
                appResponseBody,
                headers,
              );
              if (
                customResponse &&
                existingRecord &&
                (
                  existingRecord as {
                    traceId: string;
                    response: unknown;
                  }
                ).response === null
              ) {
                const tenantDb = await this.dbManager.getTenantDb(tenantId);
                await tenantDb.transaction(async (tx) => {
                  assertValidSchemaName(schemaName);
                  await tx.execute(
                    sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
                  );
                  await tx
                    .update(inboundGateway)
                    .set({
                      response: {
                        status: customResponse.status,
                        contentType: customResponse.contentType,
                        body: customResponse.body,
                      },
                    })
                    .where(
                      sql`${inboundGateway.traceId} = ${existingTraceIdOutside}`,
                    );
                });
              }
            }
          }
        } catch (error_: unknown) {
          this.logger.error(
            { err: error_ instanceof Error ? error_.message : String(error_) },
            'Failed to lookup and re-enqueue duplicate webhook',
          );
        }

        const customResponse = executeAppWebhookResponses(
          appResponseBody,
          headers,
        );
        if (customResponse) {
          this.logger.debug(
            {
              event: 'l1.app_response',
              contentType: customResponse.contentType,
              status: customResponse.status,
            },
            'Returning app-defined synchronous response (idempotency path)',
          );
          res
            .status(customResponse.status)
            .set('Content-Type', customResponse.contentType)
            .send(customResponse.body);
          return;
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
