import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type {
  TraceRepositoryPort,
  TraceListResult,
  FullTrace,
  LayerDetail,
  TraceSummary,
} from '../../core/ports/outbound/trace-repository.port.js';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  buildTenantSchema,
  assertValidSchemaName,
} from '@soopa/database';
import { DB_MANAGER } from '@soopa/dbmanager';
import type { DatabaseManager } from '@soopa/dbmanager';
import { sql, eq, and, ne, lt, or, desc } from 'drizzle-orm';

@Injectable()
export class DrizzleTraceRepositoryAdapter implements TraceRepositoryPort {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  async resolveSourceConnectionForStitch(
    orgId: string,
    stitchId: string,
    destDataSourceId: string,
    destSchemaName: string,
  ): Promise<string> {
    const tenantDb = await this.dbManager.getTenantDb(orgId);
    const { outboundGateway } = buildTenantSchema(destSchemaName);

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

  async listTraces(
    _orgId: string,
    stitchId: string,
    _workspaceId: string | undefined,
    srcSchemaName: string,
    limit: number,
    cursorTs: Date | undefined,
    cursorId: string | undefined,
  ): Promise<TraceListResult> {
    const { syncLog } = buildTenantSchema(srcSchemaName);

    let cursorCondition: ReturnType<typeof or> | undefined = undefined;
    if (cursorTs && cursorId) {
      cursorCondition = or(
        lt(syncLog.timestamp, cursorTs),
        and(sql`${syncLog.timestamp} = ${cursorTs}`, lt(syncLog.id, cursorId)),
      );
    }

    const rows = await this.db.transaction(async (tx) => {
      assertValidSchemaName(srcSchemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.identifier(srcSchemaName)}`,
      );
      return tx
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
        .where(and(eq(syncLog.routeId, stitchId), cursorCondition))
        .orderBy(desc(syncLog.timestamp), desc(syncLog.id))
        .limit(limit + 1);
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const lastRow = page.at(-1);

    return {
      data: page as unknown as TraceSummary[],
      nextCursor:
        hasMore && lastRow
          ? `${lastRow.timestamp.toISOString()}:${lastRow.id}`
          : null,
    };
  }

  async getTrace(
    stitchId: string,
    traceId: string,
    srcDataSourceId: string,
    srcSchemaName: string,
    destSchemaName: string,
  ): Promise<FullTrace> {
    const { syncLog, inboundGateway, replicaEntity, normalizedEntity } =
      buildTenantSchema(srcSchemaName);

    const { outboundGateway } = buildTenantSchema(destSchemaName);

    const [srcResults, l5Rows] = await Promise.all([
      this.db.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.identifier(srcSchemaName)}`,
        );

        const exists = await tx
          .select({ id: syncLog.id })
          .from(syncLog)
          .where(
            and(eq(syncLog.traceId, traceId), eq(syncLog.routeId, stitchId)),
          )
          .limit(1);

        if (exists.length === 0) return null;

        const [layers, l1Rows, l2Rows, l3Rows] = await Promise.all([
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
          tx
            .select()
            .from(normalizedEntity)
            .where(eq(normalizedEntity.traceId, traceId))
            .limit(1),
        ]);

        return { layers, l1Rows, l2Rows, l3Rows };
      }),
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
