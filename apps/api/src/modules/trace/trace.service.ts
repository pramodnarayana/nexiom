import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { eq, and, desc, lt, or, sql, ne } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  integrationStitches,
  buildTenantSchema,
  assertValidSchemaName,
} from '@soopa/database';
import { StorageResolverService } from '@soopa/engine';
import type { DatabaseManager } from '@soopa/dbmanager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TraceSummary {
  id: string;
  traceId: string;
  layer: string;
  status: string;
  durationMs: number | null;
  routeId: string | null;
  timestamp: Date;
}

export interface TraceListResult {
  data: TraceSummary[];
  /**
   * Opaque composite cursor for the next page.
   * Format: "<ISO-timestamp>:<uuid-id>" — both components required for stable ordering.
   */
  nextCursor: string | null;
}

export interface LayerDetail {
  layer: string;
  status: string;
  durationMs: number | null;
  timestamp: Date;
}

export interface FullTrace {
  traceId: string;
  layers: LayerDetail[];
  inboundGateway: {
    id: string;
    dataSourceId: string;
    objectType: string | null;
    request: unknown;
    response: unknown;
    headers: unknown;
    extReqId: string | null;
    status: string;
    createdAt: Date;
  } | null;
  replicaEntity: {
    id: string;
    entityId: string;
    entityType: string;
    data: unknown;
    version: number;
    updatedAt: Date;
  } | null;
  normalizedEntity: {
    id: string;
    canonicalType: string;
    data: unknown;
    createdAt: Date;
  } | null;
  outboundGateway: {
    id: string;
    routeId: string;
    reqPayload: unknown;
    resPayload: unknown;
    statusCode: number | null;
    status: string;
    attemptCount: number;
    createdAt: Date;
    updatedAt: Date;
  } | null;
}

const MAX_PAGE_LIMIT = 100;
const DEFAULT_LIMIT = 50;

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

interface ParsedCursor {
  timestamp: Date;
  id: string;
}

/**
 * Encodes a composite cursor from a sync_log row.
 * Format: "<ISO-timestamp>:<rowId>" — both components guarantee stable ordering.
 */
function encodeCursor(timestamp: Date, id: string): string {
  return `${timestamp.toISOString()}:${id}`;
}

/**
 * Parses and validates a composite cursor string.
 * Throws BadRequestException on malformed input so the caller surfaces a 400.
 */
function parseCursor(cursor: string): ParsedCursor {
  const separatorIdx = cursor.lastIndexOf(':');
  if (separatorIdx === -1) {
    throw new BadRequestException(
      'Invalid cursor format — expected "<timestamp>:<id>"',
    );
  }
  const ts = cursor.slice(0, separatorIdx);
  const id = cursor.slice(separatorIdx + 1);

  const timestamp = new Date(ts);
  if (Number.isNaN(timestamp.getTime())) {
    throw new BadRequestException(
      'Invalid cursor: timestamp component is not a valid date',
    );
  }
  // UUID format: 8-4-4-4-12 hex chars
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) {
    throw new BadRequestException(
      'Invalid cursor: id component is not a valid UUID',
    );
  }

  return { timestamp, id };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class TraceService {
  constructor(
    private readonly logger: PinoLogger,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
    @Inject('DB_MANAGER') private readonly dbManager: DatabaseManager,
  ) {
    this.logger.setContext(TraceService.name);
  }

  public async resolveSourceConnectionForStitch(
    orgId: string,
    stitchId: string,
    destDataSourceId: string,
  ): Promise<string> {
    const destSchemaName =
      await this.storageResolver.resolveSchemaName(destDataSourceId);
    assertValidSchemaName(destSchemaName);

    const tenantDb = await this.dbManager.getTenantDb(orgId);
    const { outboundGateway } = buildTenantSchema(destSchemaName);

    // 1. Try to find the most recent outbound_gateway record for this stitch
    const obRecords = await tenantDb.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.identifier(destSchemaName)}`,
      );
      return tx
        .select({ srcDataSourceId: outboundGateway.srcDataSourceId })
        .from(outboundGateway)
        .where(eq(outboundGateway.routeId, stitchId))
        .limit(1);
    });

    if (obRecords.length > 0 && obRecords[0].srcDataSourceId) {
      return obRecords[0].srcDataSourceId;
    }

    // 2. Fallback: Find the first connection in the workspace that is not the destination connection
    const { dataSources } = await import('@soopa/database');
    const sources = await this.db
      .select({ id: dataSources.id })
      .from(dataSources)
      .where(
        and(
          eq(dataSources.tenantId, orgId),
          ne(dataSources.id, destDataSourceId),
        ),
      )
      .limit(1);

    if (sources.length > 0) {
      return sources[0].id;
    }

    throw new NotFoundException(
      `Could not resolve source connection for stitch ${stitchId}`,
    );
  }

  /**
   * Returns a paginated timeline of sync_log entries for a given stitch.
   *
   * Scoping:
   *  - Only rows where routeId = stitchId are returned, preventing leakage of
   *    traces from other stitches that share the same source connection.
   *    (L1/L2 rows with routeId IS NULL are excluded — they have no route context.)
   *
   * Pagination:
   *  - Cursor is a composite of (timestamp, id) to guarantee stable ordering even
   *    when multiple rows share the same millisecond timestamp.
   *  - Condition: (timestamp < cursorTs) OR (timestamp = cursorTs AND id < cursorId)
   *  - Ordering: timestamp DESC, id DESC
   */
  async listTraces(
    orgId: string,
    stitchId: string,
    workspaceId: string | undefined,
    limit = DEFAULT_LIMIT,
    cursor?: string,
  ): Promise<TraceListResult> {
    const safeLimit = Math.min(Math.max(1, limit), MAX_PAGE_LIMIT);

    const stitch = await this.db.query.integrationStitches.findFirst({
      where: workspaceId
        ? and(
            eq(integrationStitches.id, stitchId),
            eq(integrationStitches.orgId, orgId),
            eq(integrationStitches.workspaceId, workspaceId),
          )
        : and(
            eq(integrationStitches.id, stitchId),
            eq(integrationStitches.orgId, orgId),
          ),
      columns: { id: true, workspaceId: true, destDataSourceId: true },
    });
    if (!stitch) {
      throw new NotFoundException(`Stitch ${stitchId} not found`);
    }

    const srcDataSourceId = await this.resolveSourceConnectionForStitch(
      orgId,
      stitchId,
      stitch.destDataSourceId,
    );

    const schemaName =
      await this.storageResolver.resolveSchemaName(srcDataSourceId);
    assertValidSchemaName(schemaName);
    const { syncLog } = buildTenantSchema(schemaName);

    // Composite cursor condition: rows before (timestamp, id) in DESC order
    let cursorCondition: ReturnType<typeof or> | undefined = undefined;
    if (cursor) {
      const { timestamp: cursorTs, id: cursorId } = parseCursor(cursor);
      // (ts < cursorTs) OR (ts = cursorTs AND id < cursorId)
      cursorCondition = or(
        lt(syncLog.timestamp, cursorTs),
        and(sql`${syncLog.timestamp} = ${cursorTs}`, lt(syncLog.id, cursorId)),
      );
    }

    // Fetch one extra row to detect next-page without a COUNT query
    const rows = await this.db.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}`,
      );
      return (
        tx
          .select({
            id: syncLog.id,
            traceId: syncLog.traceId,
            layer: syncLog.layer,
            status: syncLog.status,
            durationMs: syncLog.durationMs,
            routeId: syncLog.routeId,
            timestamp: syncLog.timestamp,
          })
          .from(syncLog)
          // Scope to this stitch's routeId — prevents cross-stitch leakage
          .where(and(eq(syncLog.routeId, stitchId), cursorCondition))
          .orderBy(desc(syncLog.timestamp), desc(syncLog.id))
          .limit(safeLimit + 1)
      );
    });

    const hasMore = rows.length > safeLimit;
    const page = rows.slice(0, safeLimit);
    const lastRow = page.at(-1);

    return {
      data: page as TraceSummary[],
      nextCursor:
        hasMore && lastRow ? encodeCursor(lastRow.timestamp, lastRow.id) : null,
    };
  }

  /**
   * Returns the full trace for a single traceId — all sync_log rows plus
   * the hydrated L1/L2/L3/L5–L6 data rows for that trace, all scoped to
   * the verified stitch so cross-stitch data leakage is impossible.
   *
   * Stitch validation:
   *  - The sync_log query is additionally filtered by routeId = stitchId,
   *    so a traceId that belongs to a different stitch returns 0 layers
   *    and is surfaced as a 404.
   *  - L5/L6 (outbound_gateway) is filtered by both traceId AND routeId = stitchId.
   *  - L1–L3 are filtered by traceId only (they live in the src schema and
   *    do not carry a routeId at ingestion time for early-layer entries).
   */
  async getTrace(
    orgId: string,
    stitchId: string,
    traceId: string,
    workspaceId: string | undefined,
  ): Promise<FullTrace> {
    const stitch = await this.db.query.integrationStitches.findFirst({
      where: workspaceId
        ? and(
            eq(integrationStitches.id, stitchId),
            eq(integrationStitches.orgId, orgId),
            eq(integrationStitches.workspaceId, workspaceId),
          )
        : and(
            eq(integrationStitches.id, stitchId),
            eq(integrationStitches.orgId, orgId),
          ),
      columns: {
        id: true,
        destDataSourceId: true,
      },
    });
    if (!stitch) {
      throw new NotFoundException(`Stitch ${stitchId} not found`);
    }

    const srcDataSourceId = await this.resolveSourceConnectionForStitch(
      orgId,
      stitchId,
      stitch.destDataSourceId,
    );

    const [srcSchemaName, destSchemaName] = await Promise.all([
      this.storageResolver.resolveSchemaName(srcDataSourceId),
      this.storageResolver.resolveSchemaName(stitch.destDataSourceId),
    ]);

    assertValidSchemaName(srcSchemaName);
    const { syncLog, inboundGateway, replicaEntity, normalizedEntity } =
      buildTenantSchema(srcSchemaName);

    assertValidSchemaName(destSchemaName);
    const { outboundGateway } = buildTenantSchema(destSchemaName);

    const [srcResults, l5Rows] = await Promise.all([
      // Source schema logic: batch all 4 queries into one transaction to save pool connections
      this.db.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.identifier(srcSchemaName)}`,
        );

        // 1. Existence check: trace must have at least one route-bound sync_log entry for this stitch
        const exists = await tx
          .select({ id: syncLog.id })
          .from(syncLog)
          .where(
            and(eq(syncLog.traceId, traceId), eq(syncLog.routeId, stitchId)),
          )
          .limit(1);

        if (exists.length === 0) {
          return null;
        }

        // Run the 4 actual data queries in parallel inside the single transaction
        const [layers, l1Rows, l2Rows, l3Rows] = await Promise.all([
          // Full timeline without routeId filter to capture early layers (L1/L2 where routeId is NULL)
          tx
            .select({
              layer: syncLog.layer,
              status: syncLog.status,
              durationMs: syncLog.durationMs,
              timestamp: syncLog.timestamp,
            })
            .from(syncLog)
            .where(eq(syncLog.traceId, traceId))
            .orderBy(syncLog.timestamp, syncLog.id),
          // L1: traceId scope (dataSourceId = src implied by schema)
          tx
            .select()
            .from(inboundGateway)
            .where(
              and(
                eq(inboundGateway.traceId, traceId),
                eq(inboundGateway.dataSourceId, srcDataSourceId),
              ),
            )
            .limit(1),
          // L2
          tx
            .select()
            .from(replicaEntity)
            .where(
              and(
                eq(replicaEntity.traceId, traceId),
                eq(replicaEntity.dataSourceId, srcDataSourceId),
              ),
            )
            .limit(1),
          // L3
          tx
            .select()
            .from(normalizedEntity)
            .where(eq(normalizedEntity.traceId, traceId))
            .limit(1),
        ]);

        return { layers, l1Rows, l2Rows, l3Rows };
      }),
      // L5/L6: dest schema
      this.db.transaction(async (tx) => {
        assertValidSchemaName(destSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.identifier(destSchemaName)}`,
        );
        return tx
          .select()
          .from(outboundGateway)
          .where(
            and(
              eq(outboundGateway.traceId, traceId),
              eq(outboundGateway.routeId, stitchId),
            ),
          )
          .limit(1);
      }),
    ]);

    if (!srcResults) {
      throw new NotFoundException(
        `Trace ${traceId} not found for stitch ${stitchId}`,
      );
    }

    const { layers, l1Rows, l2Rows, l3Rows } = srcResults;

    this.logger.debug(
      { stitchId, traceId, layerCount: layers.length },
      'trace.get',
    );

    const l1 = l1Rows[0] ?? null;
    const l2 = l2Rows[0] ?? null;
    const l3 = l3Rows[0] ?? null;
    const l5 = l5Rows[0] ?? null;

    return {
      traceId,
      layers: layers as LayerDetail[],
      inboundGateway: l1
        ? {
            id: l1.id,
            dataSourceId: l1.dataSourceId,
            objectType: l1.objectType,
            request: l1.request,
            response: l1.response,
            headers: l1.headers,
            extReqId: l1.extReqId,
            status: l1.status,
            createdAt: l1.createdAt,
          }
        : null,
      replicaEntity: l2
        ? {
            id: l2.id,
            entityId: l2.entityId,
            entityType: l2.entityType,
            data: l2.data,
            version: l2.version,
            updatedAt: l2.updatedAt,
          }
        : null,
      normalizedEntity: l3
        ? {
            id: l3.id,
            canonicalType: l3.canonicalType,
            data: l3.data,
            createdAt: l3.createdAt,
          }
        : null,
      outboundGateway: l5
        ? {
            id: l5.id,
            routeId: l5.routeId,
            reqPayload: l5.payload,
            resPayload: l5.response,
            statusCode: l5.statusCode,
            status: l5.status,
            attemptCount: l5.attempts,
            createdAt: l5.createdAt,
            updatedAt: l5.updatedAt,
          }
        : null,
    };
  }
}
