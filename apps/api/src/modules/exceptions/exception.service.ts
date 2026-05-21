import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { eq, inArray, and, or, lt, sql } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  integrationStitches,
  buildTenantSchema,
  assertValidSchemaName,
} from '@nexiom/database';
import { StorageResolverService } from '@nexiom/engine';
import { QueueService, QueueName } from '@nexiom/queue';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum rows returned per schema when no pagination params are provided.
 * This is a documented contract: callers must use limit/offset for full scans.
 */
const RECENT_EXCEPTION_LIMIT = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExceptionStatus = 'unresolved' | 'dismissed';

export interface ExceptionItem {
  id: string;
  traceId: string;
  /** routeId equals stitchId — included for client convenience. */
  routeId: string;
  reqPayload: unknown;
  resPayload: unknown;
  statusCode: number | null;
  attemptCount: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  updatedAtRaw: string;
}

export interface ExceptionListResult {
  data: ExceptionItem[];
  /**
   * Real COUNT(*) of matching rows across all schemas for this filter.
   * Reflects total matching rows, not the length of the paginated slice.
   */
  total: number;
  limit: number;
  /**
   * Opaque cursor for the next page — format: "<ISO-updatedAt>:<uuid-id>".
   * Null when all results have been returned.
   */
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

function encodeExceptionCursor(updatedAtRaw: string, id: string): string {
  return `${updatedAtRaw}:${id}`;
}

function parseExceptionCursor(cursor: string): {
  updatedAtRaw: string;
  id: string;
} {
  const sepIdx = cursor.lastIndexOf(':');
  if (sepIdx === -1) {
    throw new BadRequestException(
      'Invalid exception cursor — expected "<updatedAtRaw>:<id>"',
    );
  }
  const updatedAtRaw = cursor.slice(0, sepIdx);
  const id = cursor.slice(sepIdx + 1);

  if (!updatedAtRaw || isNaN(Number(updatedAtRaw))) {
    throw new BadRequestException(
      'Invalid exception cursor: timestamp component invalid',
    );
  }
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) {
    throw new BadRequestException(
      'Invalid exception cursor: id component is not a valid UUID',
    );
  }
  return { updatedAtRaw, id };
}

@Injectable()
export class ExceptionService {
  constructor(
    private readonly logger: PinoLogger,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
    private readonly queueService: QueueService,
  ) {
    this.logger.setContext(ExceptionService.name);
  }

  /**
   * Lists outbound_gateway exception rows across all dest-connection schemas
   * for stitches belonging to `orgId`.
   *
   * Pagination:
   *  - Cursor-based: `cursor` encodes "<updatedAt>:<id>" for stable ordering
   *    even when multiple rows share the same millisecond updatedAt.
   *  - `limit` (default 50, max RECENT_EXCEPTION_LIMIT) controls page size.
   *  - `total` is a real COUNT(*), not the length of the returned slice.
   *
   * Filtering:
   *  - SQL-level routeId IN (stitchIds) — only rows belonging to this org.
   *  - Status filter uses the explicit DISMISSED / FAIL+RETRY constants.
   */
  async listExceptions(
    orgId: string,
    filter: { status?: ExceptionStatus } = {},
    pagination: { limit?: number; cursor?: string } = {},
  ): Promise<ExceptionListResult> {
    const limit = Math.min(
      Math.max(1, pagination.limit ?? 50),
      RECENT_EXCEPTION_LIMIT,
    );

    let cursorCondition: ReturnType<typeof or> | undefined = undefined;
    if (pagination.cursor) {
      const { updatedAtRaw, id } = parseExceptionCursor(pagination.cursor);
      cursorCondition = or(
        lt(
          sql`updated_at`,
          sql`to_timestamp(${updatedAtRaw}::double precision)`,
        ),
        and(
          sql`updated_at = to_timestamp(${updatedAtRaw}::double precision)`,
          lt(sql`id`, id),
        ),
      );
    }

    const stitches = await this.db.query.integrationStitches.findMany({
      where: eq(integrationStitches.orgId, orgId),
      columns: { id: true, destDataSourceId: true },
    });

    if (stitches.length === 0) {
      return { data: [], total: 0, limit, nextCursor: null };
    }

    // Group stitches by dest connection — one schema query per unique connection
    const byConnection = new Map<string, string[]>();
    for (const s of stitches) {
      const list = byConnection.get(s.destDataSourceId) ?? [];
      list.push(s.id);
      byConnection.set(s.destDataSourceId, list);
    }

    const allRows: ExceptionItem[] = [];
    let grandTotal = 0;

    // Cumulatively fetch rows from each schema (respecting their per-schema cursor)
    // until we have limit+1 total in allRows. Continue looping to get the total count.
    for (const [destConnId, stitchIds] of byConnection.entries()) {
      let schemaName: string;
      try {
        schemaName = await this.storageResolver.resolveSchemaName(destConnId);
      } catch (error) {
        throw new BadRequestException(
          `Failed to resolve schema for destination connection ${destConnId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const { outboundGateway } = buildTenantSchema(schemaName);

      // Build status filter — use raw SQL to avoid Drizzle's compiled enum
      // type constraint on DISMISSED until the @nexiom/database package is rebuilt.
      const statusSql =
        filter.status === 'dismissed'
          ? sql`${outboundGateway.status} = 'DISMISSED'`
          : sql`${outboundGateway.status} IN ('FAIL', 'RETRY')`;

      // SQL-level routeId IN (...) — only rows belonging to this org's stitches.
      const routeFilter = inArray(outboundGateway.routeId, stitchIds);
      const whereClause = and(statusSql, routeFilter);

      const cursorWhereClause = cursorCondition
        ? and(whereClause, cursorCondition)
        : whereClause;

      const { rows, rowCount } = await this.db.transaction(async (tx) => {
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        const countQuery = tx
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(outboundGateway)
          .where(whereClause);

        // Always fetch limit + 1 to prevent starvation and compute pagination correctly across schemas
        const dataQuery = tx
          .select({
            id: outboundGateway.id,
            traceId: outboundGateway.traceId,
            routeId: outboundGateway.routeId,
            payload: outboundGateway.payload,
            response: outboundGateway.response,
            statusCode: outboundGateway.statusCode,
            attempts: outboundGateway.attempts,
            status: outboundGateway.status,
            createdAt: outboundGateway.createdAt,
            updatedAt: outboundGateway.updatedAt,
            updatedAtRaw: sql<string>`extract(epoch from ${outboundGateway.updatedAt})::text`,
          })
          .from(outboundGateway)
          .where(cursorWhereClause)
          .orderBy(
            sql`${outboundGateway.updatedAt} DESC`,
            sql`${outboundGateway.id} DESC`,
          )
          .limit(limit + 1);

        const [countResult, dataRows] = await Promise.all([
          countQuery,
          dataQuery,
        ]);

        return {
          rows: dataRows,
          rowCount: countResult[0]?.count ?? 0,
        };
      });

      grandTotal += rowCount;

      for (const row of rows) {
        allRows.push({
          id: row.id,
          traceId: row.traceId,
          routeId: row.routeId,
          reqPayload: row.payload,
          resPayload: row.response,
          statusCode: row.statusCode,
          attemptCount: row.attempts,
          status: row.status,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          updatedAtRaw: row.updatedAtRaw,
        });
      }
    }

    // Sort to deterministically break ties and avoid duplicates across pages
    allRows.sort((a, b) => {
      const timeDiff = Number(b.updatedAtRaw) - Number(a.updatedAtRaw);
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    // Compute cursor from the last row of the combined sorted page
    const hasMore = allRows.length > limit;
    const page = allRows.slice(0, limit);
    const lastRow = page.at(-1);

    return {
      data: page,
      total: grandTotal,
      limit,
      nextCursor:
        hasMore && lastRow
          ? encodeExceptionCursor(lastRow.updatedAtRaw, lastRow.id)
          : null,
    };
  }

  /**
   * Re-enqueues an outbound_gateway row to the Delivery_Queue for retry.
   *
   * The UPDATE is guarded with `AND status IN (RETRYABLE_STATUSES)` so that:
   *  - Concurrent retries (two operators clicking at the same time) are safe.
   *  - Retrying a SUCCESS or PENDING row (a client bug) is rejected.
   *
   * If the guarded UPDATE affects 0 rows, a ConflictException is thrown so the
   * caller knows another process has already changed the row's status.
   */
  async retryException(
    orgId: string,
    outboundGatewayId: string,
  ): Promise<{ queued: boolean }> {
    const { outboundGatewayRow, schemaName } = await this.resolveOutboundRow(
      orgId,
      outboundGatewayId,
    );

    const stitch = await this.db.query.integrationStitches.findFirst({
      where: eq(integrationStitches.id, outboundGatewayRow.routeId),
      columns: { srcDataSourceId: true, destDataSourceId: true },
    });

    if (!stitch) {
      throw new NotFoundException(
        `Stitch ${outboundGatewayRow.routeId} not found for retry payload`,
      );
    }

    const { outboundGateway } = buildTenantSchema(schemaName);

    await this.db.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );

      const updatedRows = await tx
        .update(outboundGateway)
        .set({ status: 'PENDING' } as never)
        .where(
          and(
            eq(outboundGateway.id, outboundGatewayId),
            sql`${outboundGateway.status} IN ('FAIL', 'RETRY', 'DISMISSED')`,
          ),
        )
        .returning({
          traceId: outboundGateway.traceId,
          routeId: outboundGateway.routeId,
          payload: outboundGateway.payload,
        });

      if (updatedRows.length === 0) {
        throw new ConflictException(
          `Exception ${outboundGatewayId} is not in a retryable state (concurrent change or invalid status)`,
        );
      }

      const row = updatedRows[0];

      try {
        await this.queueService.send(QueueName.DeliveryQueue, {
          traceId: row.traceId,
          srcDataSourceId: stitch.srcDataSourceId,
          destDataSourceId: stitch.destDataSourceId,
          routeId: row.routeId,
          hydratedPayload: row.payload,
        });
      } catch (sendErr) {
        this.logger.warn(
          {
            id: outboundGatewayId,
            err: sendErr instanceof Error ? sendErr.message : String(sendErr),
          },
          'exception.retry: queueService.send failed',
        );
        throw sendErr; // Rolls back the PENDING status update automatically
      }
    });

    this.logger.info(
      { id: outboundGatewayId, traceId: outboundGatewayRow.traceId },
      'exception.retry',
    );

    return { queued: true };
  }

  /**
   * Marks an outbound_gateway row as DISMISSED so it no longer appears
   * in the unresolved exceptions list.
   *
   * The UPDATE is guarded with `AND status IN (DISMISSABLE_STATUSES)` to
   * prevent dismissing a SUCCESS, PENDING, or already-DISMISSED row, and
   * to handle concurrent dismiss calls safely.
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

    const updated = await this.db.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      return tx
        .update(outboundGateway)
        .set({ status: 'DISMISSED' } as never)
        .where(
          and(
            eq(outboundGateway.id, outboundGatewayId),
            sql`${outboundGateway.status} IN ('FAIL', 'RETRY')`,
          ),
        )
        .returning({ id: outboundGateway.id });
    });

    if (updated.length === 0) {
      throw new ConflictException(
        `Exception ${outboundGatewayId} is not in a dismissable state (concurrent change or already dismissed)`,
      );
    }

    this.logger.info({ id: outboundGatewayId }, 'exception.dismissed');
    return { dismissed: true };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Locates the outbound_gateway row across all dest schemas for the org.
   *
   * Uses Promise.allSettled to fan out across schemas in parallel (O(1) latency).
   * Each schema handler returns a sentinel { outboundGatewayRow: null } when the
   * row is not found in that schema — "not found" is not an error.
   *
   * Infrastructure failures (schema resolution errors, DB errors) are real errors
   * and are rethrown so they surface as 500s rather than silent 404s.
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
      columns: { id: true, destDataSourceId: true },
    });

    const stitchIds = stitches.map((s) => s.id);
    if (stitchIds.length === 0) {
      throw new NotFoundException(
        `Exception ${outboundGatewayId} not found for this organization`,
      );
    }

    const destConnIds = [...new Set(stitches.map((s) => s.destDataSourceId))];

    type SchemaHit =
      | {
          outboundGatewayRow: { traceId: string; routeId: string };
          schemaName: string;
        }
      | { outboundGatewayRow: null; schemaName: string };

    const hits = await Promise.allSettled(
      destConnIds.map(async (destConnId): Promise<SchemaHit> => {
        // Let schema resolution errors propagate as real rejections.
        const schemaName =
          await this.storageResolver.resolveSchemaName(destConnId);
        const { outboundGateway } = buildTenantSchema(schemaName);

        // Let DB errors propagate as real rejections.
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
            .where(
              and(
                eq(outboundGateway.id, outboundGatewayId),
                inArray(outboundGateway.routeId, stitchIds),
              ),
            )
            .limit(1);
        });

        // Return sentinel — not an error, just not in this schema.
        if (rows.length === 0) return { outboundGatewayRow: null, schemaName };
        return { outboundGatewayRow: rows[0], schemaName };
      }),
    );

    // Infrastructure errors bubble as 500 — check rejections first.
    for (const result of hits) {
      if (result.status === 'rejected') {
        const error =
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason));
        this.logger.error(
          { err: error },
          'exception.resolve: infrastructure error during schema fan-out',
        );
        throw error;
      }
    }

    // Find the first schema that contained the row.
    for (const result of hits) {
      if (
        result.status === 'fulfilled' &&
        result.value.outboundGatewayRow !== null
      ) {
        return result.value as {
          outboundGatewayRow: { traceId: string; routeId: string };
          schemaName: string;
        };
      }
    }

    throw new NotFoundException(
      `Exception ${outboundGatewayId} not found for this organization`,
    );
  }
}
