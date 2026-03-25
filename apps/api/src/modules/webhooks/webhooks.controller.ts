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
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
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

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
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
   *   - On PgError 23505 (unique_violation) -- the event was already received;
   *     returning 202 prevents the vendor from retrying indefinitely.
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
    const schemaName =
      await this.storageResolver.resolveSchemaName(connectionId);
    const { inboundGateway } = buildTenantSchema(schemaName);
    const traceId = randomUUID();
    const extReqId = headers['x-webhook-id'] ?? headers['x-event-id'];

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
          headers: headers as Record<string, unknown>,
          extReqId,
        });
      });
      this.logger.debug(
        `L1 ingested: traceId=${traceId} connectionId=${connectionId}`,
      );
    } catch (err: unknown) {
      // Duplicate extReqId or traceId -- idempotent accept.
      if (isPgUniqueViolation(err)) {
        this.logger.debug(
          `Duplicate webhook ignored (23505): connectionId=${connectionId} extReqId=${extReqId ?? 'none'}`,
        );
        return;
      }
      throw err;
    }
  }
}

function isPgUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
