import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { eq, inArray } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  integrationStitches,
  buildTenantSchema,
  assertValidSchemaName,
} from '@nexiom/database';
import { StorageResolverService } from '@nexiom/engine';
import { QueueService, QueueName } from '@nexiom/queue';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExceptionStatus = 'unresolved' | 'dismissed';

export interface ExceptionItem {
  id: string;
  traceId: string;
  routeId: string;
  stitchId: string | null;
  reqPayload: unknown;
  resPayload: unknown;
  statusCode: number | null;
  attemptCount: number;
  /** Pipeline status: FAIL | RETRY for unresolved; SKIPPED for dismissed. */
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExceptionListResult {
  data: ExceptionItem[];
  total: number;
}

/**
 * Pipeline statuses that represent a dismissible/resolved state.
 *
 * Design note: SKIPPED is a deliberate dual-use status here:
 *   - Set by FanOutService when a sync condition does not match (normal flow).
 *   - Set by ExceptionService.dismissException() to mark a FAIL as "no-op".
 *
 * Both cases mean "do not deliver and do not alert further", which is correct
 * semantically. A future migration can introduce a separate DISMISSED status
 * if finer-grained reporting is required.
 */
const DISMISSED_STATUSES = ['SKIPPED'] as const;

/** Pipeline statuses surfaced to the Exception Center as "unresolved". */
const UNRESOLVED_STATUSES = ['FAIL', 'RETRY'] as const;

@Injectable()
export class ExceptionService {
  constructor(
    @InjectPinoLogger(ExceptionService.name)
    private readonly logger: PinoLogger,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Lists FAIL/RETRY outbound_gateway rows across all dest-connection schemas
   * for stitches belonging to `orgId`, optionally filtered by status.
   *
   * Performance:
   *  - Stitches are grouped by dest connection so each unique schema is
   *    queried exactly once, regardless of how many stitches share it.
   *  - Schema resolutions and per-schema DB queries run in parallel via
   *    Promise.all — total latency = max(single schema latency), not sum.
   */
  async listExceptions(
    orgId: string,
    filter: { status?: ExceptionStatus } = {},
  ): Promise<ExceptionListResult> {
    const stitches = await this.db.query.integrationStitches.findMany({
      where: eq(integrationStitches.orgId, orgId),
      columns: { id: true, destConnectionId: true },
    });

    if (stitches.length === 0) {
      return { data: [], total: 0 };
    }

    // Group stitches by dest connection — one schema query per unique connection
    const byConnection = new Map<string, string[]>();
    for (const s of stitches) {
      const list = byConnection.get(s.destConnectionId) ?? [];
      list.push(s.id);
      byConnection.set(s.destConnectionId, list);
    }

    const results: ExceptionItem[] = [];

    await Promise.all(
      Array.from(byConnection.entries()).map(
        async ([destConnId, stitchIds]) => {
          let schemaName: string;
          try {
            schemaName =
              await this.storageResolver.resolveSchemaName(destConnId);
          } catch {
            // Connection may have been deleted — skip gracefully, log a warning
            this.logger.warn(
              { destConnId },
              'exception.list: could not resolve schema, skipping connection',
            );
            return;
          }

          const { outboundGateway } = buildTenantSchema(schemaName);

          // Build status filter using the typed const tuples so Drizzle's enum
          // column overload is satisfied — spreading to string[] breaks the type.
          const statusFilter =
            filter.status === 'dismissed'
              ? inArray(outboundGateway.status, DISMISSED_STATUSES)
              : inArray(outboundGateway.status, UNRESOLVED_STATUSES);

          const rows = await this.db.transaction(async (tx) => {
            assertValidSchemaName(schemaName);
            await tx.execute(
              sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
            );
            return tx
              .select()
              .from(outboundGateway)
              .where(statusFilter)
              .orderBy(sql`${outboundGateway.updatedAt} DESC`)
              .limit(200);
          });

          for (const row of rows) {
            results.push({
              id: row.id,
              traceId: row.traceId,
              routeId: row.routeId,
              stitchId: stitchIds.includes(row.routeId) ? row.routeId : null,
              reqPayload: row.reqPayload,
              resPayload: row.resPayload,
              statusCode: row.statusCode,
              attemptCount: row.attemptCount,
              status: row.status,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            });
          }
        },
      ),
    );

    results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return { data: results, total: results.length };
  }

  /**
   * Re-enqueues an outbound_gateway row to the Delivery_Queue for retry.
   * Resets status to PENDING atomically before enqueuing so the Delivery
   * Service will pick it up on its next poll, even if the pod restarts
   * between the update and the enqueue.
   */
  async retryException(
    orgId: string,
    outboundGatewayId: string,
  ): Promise<{ queued: boolean }> {
    const { outboundGatewayRow, schemaName } = await this.resolveOutboundRow(
      orgId,
      outboundGatewayId,
    );

    const { outboundGateway } = buildTenantSchema(schemaName);

    await this.db.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      await tx
        .update(outboundGateway)
        .set({ status: 'PENDING' })
        .where(eq(outboundGateway.id, outboundGatewayId));
    });

    await this.queueService.send(QueueName.DeliveryQueue, {
      outboundGatewayId,
      traceId: outboundGatewayRow.traceId,
    });

    this.logger.info(
      { id: outboundGatewayId, traceId: outboundGatewayRow.traceId },
      'exception.retry',
    );

    return { queued: true };
  }

  /**
   * Marks an outbound_gateway row as SKIPPED so it no longer appears
   * in the unresolved exceptions list.
   */
  async dismissException(
    orgId: string,
    outboundGatewayId: string,
  ): Promise<{ dismissed: boolean }> {
    const { schemaName } = await this.resolveOutboundRow(
      orgId,
      outboundGatewayId,
    );

    const { outboundGateway } = buildTenantSchema(schemaName);

    await this.db.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      await tx
        .update(outboundGateway)
        .set({ status: 'SKIPPED' })
        .where(eq(outboundGateway.id, outboundGatewayId));
    });

    this.logger.info({ id: outboundGatewayId }, 'exception.dismissed');
    return { dismissed: true };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Locates the outbound_gateway row across all dest schemas for the org.
   *
   * Uses `Promise.allSettled` to query all dest schemas in parallel, then
   * picks the first hit. This is O(1) latency regardless of how many schemas
   * the org has, at the cost of fanning out concurrent queries — acceptable
   * because retry/dismiss are low-frequency operator actions.
   */
  private async resolveOutboundRow(
    orgId: string,
    outboundGatewayId: string,
  ): Promise<{
    outboundGatewayRow: { traceId: string; routeId: string };
    schemaName: string;
  }> {
    const stitches = await this.db.query.integrationStitches.findMany({
      where: eq(integrationStitches.orgId, orgId),
      columns: { destConnectionId: true },
    });

    // Deduplicate dest connections
    const destConnIds = [...new Set(stitches.map((s) => s.destConnectionId))];

    const hits = await Promise.allSettled(
      destConnIds.map(async (destConnId) => {
        const schemaName =
          await this.storageResolver.resolveSchemaName(destConnId);
        const { outboundGateway } = buildTenantSchema(schemaName);

        const rows = await this.db.transaction(async (tx) => {
          assertValidSchemaName(schemaName);
          await tx.execute(
            sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
          );
          return tx
            .select({
              id: outboundGateway.id,
              traceId: outboundGateway.traceId,
              routeId: outboundGateway.routeId,
            })
            .from(outboundGateway)
            .where(eq(outboundGateway.id, outboundGatewayId))
            .limit(1);
        });

        if (rows.length === 0) throw new Error('not found in this schema');
        return { outboundGatewayRow: rows[0], schemaName };
      }),
    );

    for (const result of hits) {
      if (result.status === 'fulfilled') {
        return result.value;
      }
    }

    throw new NotFoundException(
      `Exception ${outboundGatewayId} not found for this organization`,
    );
  }
}
