import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { eq, and, desc, lt } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  integrationStitches,
  buildTenantSchema,
  assertValidSchemaName,
} from '@nexiom/database';
import { StorageResolverService } from '@nexiom/engine';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TraceSummary {
  traceId: string;
  layer: string;
  status: string;
  durationMs: number | null;
  routeId: string | null;
  timestamp: Date;
}

export interface TraceListResult {
  data: TraceSummary[];
  /** Opaque cursor for the next page — pass as `cursor` query param. */
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
    connectionId: string;
    objectType: string | null;
    payload: unknown;
    headers: unknown;
    extReqId: string | null;
    status: string;
    createdAt: Date;
  } | null;
  replicaEntity: {
    id: string;
    sourceId: string;
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

@Injectable()
export class TraceService {
  constructor(
    @InjectPinoLogger(TraceService.name)
    private readonly logger: PinoLogger,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
  ) {}

  /**
   * Returns a paginated timeline of sync_log entries for a given stitch.
   * Pagination is cursor-based: `cursor` is an ISO timestamp of the oldest
   * entry on the previous page (exclusive lower bound).
   */
  async listTraces(
    orgId: string,
    stitchId: string,
    limit = DEFAULT_LIMIT,
    cursor?: string,
  ): Promise<TraceListResult> {
    const safeLimit = Math.min(Math.max(1, limit), MAX_PAGE_LIMIT);

    // Single query — verifies ownership AND fetches the connection ID we need
    const stitch = await this.db.query.integrationStitches.findFirst({
      where: and(
        eq(integrationStitches.id, stitchId),
        eq(integrationStitches.orgId, orgId),
      ),
      columns: { id: true, srcConnectionId: true },
    });
    if (!stitch) {
      throw new NotFoundException(`Stitch ${stitchId} not found`);
    }

    // sync_log lives in the source connection's tenant schema
    const schemaName = await this.storageResolver.resolveSchemaName(
      stitch.srcConnectionId,
    );
    const { syncLog } = buildTenantSchema(schemaName);

    // Build cursor condition — entries strictly older than the cursor timestamp
    let cursorCondition = undefined;
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (isNaN(cursorDate.getTime())) {
        throw new BadRequestException('Invalid cursor value');
      }
      cursorCondition = lt(syncLog.timestamp, cursorDate);
    }

    // Fetch one extra row to detect if there is a next page
    const rows = await this.db.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      return tx
        .select({
          traceId: syncLog.traceId,
          layer: syncLog.layer,
          status: syncLog.status,
          durationMs: syncLog.durationMs,
          routeId: syncLog.routeId,
          timestamp: syncLog.timestamp,
        })
        .from(syncLog)
        .where(cursorCondition)
        .orderBy(desc(syncLog.timestamp))
        .limit(safeLimit + 1);
    });

    const hasMore = rows.length > safeLimit;
    const page = rows.slice(0, safeLimit);
    const lastRow = page.at(-1);

    return {
      data: page as TraceSummary[],
      nextCursor: hasMore && lastRow ? lastRow.timestamp.toISOString() : null,
    };
  }

  /**
   * Returns the full trace for a single traceId — all sync_log rows plus
   * the hydrated L1/L2/L3/L5–L6 data rows for that trace.
   */
  async getTrace(
    orgId: string,
    stitchId: string,
    traceId: string,
  ): Promise<FullTrace> {
    // Single query — verifies ownership AND fetches both connection IDs
    const stitch = await this.db.query.integrationStitches.findFirst({
      where: and(
        eq(integrationStitches.id, stitchId),
        eq(integrationStitches.orgId, orgId),
      ),
      columns: { id: true, srcConnectionId: true, destConnectionId: true },
    });
    if (!stitch) {
      throw new NotFoundException(`Stitch ${stitchId} not found`);
    }

    // Resolve both schemas in parallel — halves latency vs sequential resolution
    const [srcSchemaName, destSchemaName] = await Promise.all([
      this.storageResolver.resolveSchemaName(stitch.srcConnectionId),
      this.storageResolver.resolveSchemaName(stitch.destConnectionId),
    ]);

    const { syncLog, inboundGateway, replicaEntity, normalizedEntity } =
      buildTenantSchema(srcSchemaName);

    const { outboundGateway } = buildTenantSchema(destSchemaName);

    // Run L1–L3 queries in source schema and L5–L6 in dest schema in parallel
    const [layers, l1Rows, l2Rows, l3Rows, l5Rows] = await Promise.all([
      // All sync_log entries for this trace (any layer)
      this.db.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
        );
        return tx
          .select({
            layer: syncLog.layer,
            status: syncLog.status,
            durationMs: syncLog.durationMs,
            timestamp: syncLog.timestamp,
          })
          .from(syncLog)
          .where(eq(syncLog.traceId, traceId))
          .orderBy(syncLog.timestamp);
      }),
      // L1 inbound_gateway
      this.db.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
        );
        return tx
          .select()
          .from(inboundGateway)
          .where(eq(inboundGateway.traceId, traceId))
          .limit(1);
      }),
      // L2 replica_entity
      this.db.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
        );
        return tx
          .select()
          .from(replicaEntity)
          .where(eq(replicaEntity.traceId, traceId))
          .limit(1);
      }),
      // L3 normalized_entity
      this.db.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
        );
        return tx
          .select()
          .from(normalizedEntity)
          .where(eq(normalizedEntity.traceId, traceId))
          .limit(1);
      }),
      // L5/L6 outbound_gateway (dest schema)
      this.db.transaction(async (tx) => {
        assertValidSchemaName(destSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
        );
        return tx
          .select()
          .from(outboundGateway)
          .where(eq(outboundGateway.traceId, traceId))
          .limit(1);
      }),
    ]);

    if (layers.length === 0) {
      throw new NotFoundException(`Trace ${traceId} not found`);
    }

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
            connectionId: l1.connectionId,
            objectType: l1.objectType,
            payload: l1.payload,
            headers: l1.headers,
            extReqId: l1.extReqId,
            status: l1.status,
            createdAt: l1.createdAt,
          }
        : null,
      replicaEntity: l2
        ? {
            id: l2.id,
            sourceId: l2.sourceId,
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
            reqPayload: l5.reqPayload,
            resPayload: l5.resPayload,
            statusCode: l5.statusCode,
            status: l5.status,
            attemptCount: l5.attemptCount,
            createdAt: l5.createdAt,
            updatedAt: l5.updatedAt,
          }
        : null,
    };
  }
}
