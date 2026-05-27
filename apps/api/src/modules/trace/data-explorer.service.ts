import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { eq, desc, and, sql, inArray, ne } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  integrationStitches,
  buildTenantSchema,
  assertValidSchemaName,
  globalEntityMap,
} from '@nexiom/database';
import { buildDrizzleFilter, type FilterGroup } from './filter-parser.js';
import { StorageResolverService } from '@nexiom/engine';
import { DB_MANAGER } from '@nexiom/dbmanager';
import type { DatabaseManager } from '@nexiom/dbmanager';

export interface ExplorerPage<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

const MAX_LIMIT = 100;

@Injectable()
export class DataExplorerService {
  constructor(
    private readonly logger: PinoLogger,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {
    this.logger.setContext(DataExplorerService.name);
  }

  // ── Shared stitch resolution ───────────────────────────────────────────────

  private async resolveStitch(
    orgId: string,
    stitchId: string,
    workspaceId?: string,
  ) {
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
      columns: { id: true, srcDataSourceId: true, destDataSourceId: true },
    });
    if (!stitch) throw new NotFoundException(`Stitch ${stitchId} not found`);
    return stitch;
  }

  private safePagination(page: number, limit: number) {
    // Coerce to numeric and guard against NaN/Infinity
    const numPage = Number(page);
    const numLimit = Number(limit);

    const safePage = Number.isFinite(numPage)
      ? Math.max(1, Math.trunc(numPage))
      : 1;
    const safeLimit = Number.isFinite(numLimit)
      ? Math.min(Math.max(1, Math.trunc(numLimit)), MAX_LIMIT)
      : MAX_LIMIT;

    const offset = (safePage - 1) * safeLimit;
    return { safePage, safeLimit, offset };
  }

  private async attachTraceStatuses(
    tenantDb: DrizzleDb,
    rows: {
      traceId?: string | null;
      status?: string | null;
      [key: string]: unknown;
    }[],
    stitchId: string,

    syncLogTableRaw: any,
  ) {
    if (rows.length === 0) return rows;
    const traceIds = rows.map((r) => r.traceId).filter(Boolean);
    if (traceIds.length === 0) return rows;

    const syncLogTable = syncLogTableRaw as Record<
      string,
      import('drizzle-orm/pg-core').AnyPgColumn
    >;

    const statuses = (await tenantDb
      .select({ traceId: syncLogTable.traceId, status: syncLogTable.status })
      .from(syncLogTableRaw)
      .where(
        and(
          inArray(syncLogTable.traceId, traceIds),
          eq(syncLogTable.routeId, stitchId),
        ),
      )) as { traceId: string; status: string }[];

    const statusMap = new Map<string, string>();
    for (const s of statuses) {
      if (s.status === 'SUCCESS' || !statusMap.has(s.traceId)) {
        statusMap.set(s.traceId, s.status);
      }
    }

    for (const row of rows) {
      if (row.traceId && statusMap.has(row.traceId)) {
        row.status = statusMap.get(row.traceId);
      } else if (!row.status) {
        row.status = 'PROCESSING';
      }
    }
    return rows;
  }

  // ── L1: Inbound Gateway ────────────────────────────────────────────────────

  async listInbound(
    orgId: string,
    stitchId: string,
    page: number,
    limit: number,
    workspaceId?: string,
    objectType?: string,
    filters?: FilterGroup,
  ) {
    const { safePage, safeLimit, offset } = this.safePagination(page, limit);
    const stitch = await this.resolveStitch(orgId, stitchId, workspaceId);
    const storageProfile = await this.storageResolver.resolveStorageProfile(
      stitch.srcDataSourceId,
    );
    const tenantDb = await this.dbManager.getTenantDb(storageProfile.tenantId);
    const schemaName = await this.storageResolver.resolveSchemaName(
      stitch.srcDataSourceId,
    );
    assertValidSchemaName(schemaName);
    const { inboundGateway, syncLog } = buildTenantSchema(schemaName);

    const baseWhere = objectType
      ? eq(inboundGateway.objectType, objectType)
      : undefined;

    const filterWhere = buildDrizzleFilter(filters, inboundGateway);
    const finalWhere = and(
      eq(inboundGateway.dataSourceId, stitch.srcDataSourceId),
      inArray(
        inboundGateway.traceId,
        tenantDb
          .select({ traceId: syncLog.traceId })
          .from(syncLog)
          .where(
            and(eq(syncLog.routeId, stitchId), ne(syncLog.status, 'SKIPPED')),
          ),
      ),
      baseWhere,
      filterWhere,
    );

    const [rows, countResult] = await Promise.all([
      tenantDb
        .select()
        .from(inboundGateway)
        .where(finalWhere)
        .orderBy(desc(inboundGateway.createdAt))
        .limit(safeLimit)
        .offset(offset),
      tenantDb
        .select({ count: sql<number>`count(*)::int` })
        .from(inboundGateway)
        .where(finalWhere),
    ]);

    await this.attachTraceStatuses(tenantDb, rows, stitchId, syncLog);

    return {
      data: rows,
      total: countResult[0]?.count ?? 0,
      page: safePage,
      limit: safeLimit,
    } satisfies ExplorerPage<(typeof rows)[number]>;
  }

  // ── Trace Viewer ───────────────────────────────────────────────────────────

  async getTrace(
    orgId: string,
    stitchId: string,
    traceId: string,
    workspaceId?: string,
  ) {
    const stitch = await this.resolveStitch(orgId, stitchId, workspaceId);

    // Fetch from source tenant
    const srcProfile = await this.storageResolver.resolveStorageProfile(
      stitch.srcDataSourceId,
    );
    const srcDb = await this.dbManager.getTenantDb(srcProfile.tenantId);
    const srcSchema = buildTenantSchema(srcProfile.schemaName);

    // Fetch from destination tenant
    const destProfile = await this.storageResolver.resolveStorageProfile(
      stitch.destDataSourceId,
    );
    const destDb = await this.dbManager.getTenantDb(destProfile.tenantId);
    const destSchema = buildTenantSchema(destProfile.schemaName);

    const [l1, l2, l3, l6] = await Promise.all([
      srcDb
        .select()
        .from(srcSchema.inboundGateway)
        .where(
          and(
            eq(srcSchema.inboundGateway.traceId, traceId),
            eq(srcSchema.inboundGateway.dataSourceId, stitch.srcDataSourceId),
          ),
        )
        .limit(1),
      srcDb
        .select()
        .from(srcSchema.replicaEntity)
        .where(
          and(
            eq(srcSchema.replicaEntity.traceId, traceId),
            eq(srcSchema.replicaEntity.dataSourceId, stitch.srcDataSourceId),
          ),
        )
        .limit(1),
      // L3 doesn't have dataSourceId natively (it links via replicaId), but traceId is unique enough in the tenant DB.
      srcDb
        .select()
        .from(srcSchema.normalizedEntity)
        .where(eq(srcSchema.normalizedEntity.traceId, traceId))
        .limit(1),
      destDb
        .select()
        .from(destSchema.outboundGateway)
        .where(
          and(
            eq(destSchema.outboundGateway.traceId, traceId),
            eq(destSchema.outboundGateway.routeId, stitchId),
          ),
        )
        .limit(1),
    ]);

    const l1Row = l1[0] || null;
    const l2Row = l2[0] || null;
    const l3Row = l3[0] || null;

    // Attach trace statuses from sync_log so the UI panel shows the correct badges
    if (l1Row)
      await this.attachTraceStatuses(
        srcDb,
        [l1Row],
        stitchId,
        srcSchema.syncLog,
      );
    if (l2Row)
      await this.attachTraceStatuses(
        srcDb,
        [l2Row],
        stitchId,
        srcSchema.syncLog,
      );
    if (l3Row)
      await this.attachTraceStatuses(
        srcDb,
        [l3Row],
        stitchId,
        srcSchema.syncLog,
      );

    return {
      traceId,
      stitchId,
      layers: {
        l1: l1Row,
        l2: l2Row,
        l3: l3Row,
        l6: l6[0] || null,
      },
    };
  }

  // ── L2: Replica Entity ─────────────────────────────────────────────────────

  async listReplica(
    orgId: string,
    stitchId: string,
    page: number,
    limit: number,
    workspaceId?: string,
    objectType?: string,
    filters?: FilterGroup,
  ) {
    const { safePage, safeLimit, offset } = this.safePagination(page, limit);
    const stitch = await this.resolveStitch(orgId, stitchId, workspaceId);
    const storageProfile = await this.storageResolver.resolveStorageProfile(
      stitch.srcDataSourceId,
    );
    const tenantDb = await this.dbManager.getTenantDb(storageProfile.tenantId);
    const schemaName = await this.storageResolver.resolveSchemaName(
      stitch.srcDataSourceId,
    );
    assertValidSchemaName(schemaName);
    const { replicaEntity, syncLog } = buildTenantSchema(schemaName);

    const conditions: import('drizzle-orm').SQL[] = [
      eq(replicaEntity.dataSourceId, stitch.srcDataSourceId),
    ];
    if (objectType) {
      conditions.push(eq(replicaEntity.entityType, objectType));
    }

    const filterWhere = buildDrizzleFilter(filters, replicaEntity);
    const finalWhere = and(
      ...conditions,
      inArray(
        replicaEntity.traceId,
        tenantDb
          .select({ traceId: syncLog.traceId })
          .from(syncLog)
          .where(
            and(eq(syncLog.routeId, stitchId), ne(syncLog.status, 'SKIPPED')),
          ),
      ),
      filterWhere,
    );

    const [rows, countResult] = await Promise.all([
      tenantDb
        .select()
        .from(replicaEntity)
        .where(finalWhere)
        .orderBy(desc(replicaEntity.updatedAt))
        .limit(safeLimit)
        .offset(offset),
      tenantDb
        .select({ count: sql<number>`count(*)::int` })
        .from(replicaEntity)
        .where(finalWhere),
    ]);

    await this.attachTraceStatuses(tenantDb, rows, stitchId, syncLog);

    return {
      data: rows,
      total: countResult[0]?.count ?? 0,
      page: safePage,
      limit: safeLimit,
    } satisfies ExplorerPage<(typeof rows)[number]>;
  }

  // ── L3: Normalized Entity ──────────────────────────────────────────────────

  async listNormalized(
    orgId: string,
    stitchId: string,
    page: number,
    limit: number,
    workspaceId?: string,
    objectType?: string,
    filters?: FilterGroup,
  ) {
    const { safePage, safeLimit, offset } = this.safePagination(page, limit);
    const stitch = await this.resolveStitch(orgId, stitchId, workspaceId);
    const storageProfile = await this.storageResolver.resolveStorageProfile(
      stitch.srcDataSourceId,
    );
    const tenantDb = await this.dbManager.getTenantDb(storageProfile.tenantId);
    const schemaName = await this.storageResolver.resolveSchemaName(
      stitch.srcDataSourceId,
    );
    assertValidSchemaName(schemaName);
    const { normalizedEntity, syncLog } = buildTenantSchema(schemaName);

    const filterWhere = buildDrizzleFilter(filters, normalizedEntity);
    const baseWhere = objectType
      ? eq(normalizedEntity.canonicalType, objectType)
      : undefined;

    const finalWhere = and(
      inArray(
        normalizedEntity.traceId,
        tenantDb
          .select({ traceId: syncLog.traceId })
          .from(syncLog)
          .where(
            and(eq(syncLog.routeId, stitchId), ne(syncLog.status, 'SKIPPED')),
          ),
      ),
      baseWhere,
      filterWhere,
    );

    const [rows, countResult] = await Promise.all([
      tenantDb
        .select()
        .from(normalizedEntity)
        .where(finalWhere)
        .orderBy(desc(normalizedEntity.createdAt))
        .limit(safeLimit)
        .offset(offset),
      tenantDb
        .select({ count: sql<number>`count(*)::int` })
        .from(normalizedEntity)
        .where(finalWhere),
    ]);

    await this.attachTraceStatuses(tenantDb, rows, stitchId, syncLog);

    return {
      data: rows,
      total: countResult[0]?.count ?? 0,
      page: safePage,
      limit: safeLimit,
    } satisfies ExplorerPage<(typeof rows)[number]>;
  }

  // ── GEM: Global Entity Map ─────────────────────────────────────────────────

  async listEntityMap(
    orgId: string,
    stitchId: string,
    page: number,
    limit: number,
    workspaceId?: string,
  ) {
    const { safePage, safeLimit, offset } = this.safePagination(page, limit);
    // Validate access via stitch
    const stitch = await this.resolveStitch(orgId, stitchId, workspaceId);
    const storageProfile = await this.storageResolver.resolveStorageProfile(
      stitch.srcDataSourceId,
    );
    const tenantId = storageProfile.tenantId;

    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    const [rows, countResult] = await Promise.all([
      tenantDb
        .select()
        .from(globalEntityMap)
        .where(eq(globalEntityMap.stitchId, stitchId))
        .orderBy(desc(globalEntityMap.lastSyncedAt))
        .limit(safeLimit)
        .offset(offset),
      tenantDb
        .select({ count: sql<number>`count(*)::int` })
        .from(globalEntityMap)
        .where(eq(globalEntityMap.stitchId, stitchId)),
    ]);
    return {
      data: rows,
      total: countResult[0]?.count ?? 0,
      page: safePage,
      limit: safeLimit,
    } satisfies ExplorerPage<(typeof rows)[number]>;
  }

  // ── L5/L6: Outbound Gateway ────────────────────────────────────────────────

  async listOutbound(
    orgId: string,
    stitchId: string,
    page: number,
    limit: number,
    workspaceId?: string,
  ) {
    const { safePage, safeLimit, offset } = this.safePagination(page, limit);
    const stitch = await this.resolveStitch(orgId, stitchId, workspaceId);
    const schemaName = await this.storageResolver.resolveSchemaName(
      stitch.destDataSourceId,
    );
    assertValidSchemaName(schemaName);
    const { outboundGateway } = buildTenantSchema(schemaName);

    const storageProfile = await this.storageResolver.resolveStorageProfile(
      stitch.destDataSourceId,
    );
    const tenantDb = await this.dbManager.getTenantDb(storageProfile.tenantId);

    const [rows, countResult] = await Promise.all([
      tenantDb
        .select()
        .from(outboundGateway)
        .where(eq(outboundGateway.routeId, stitchId))
        .orderBy(desc(outboundGateway.createdAt))
        .limit(safeLimit)
        .offset(offset),
      tenantDb
        .select({ count: sql<number>`count(*)::int` })
        .from(outboundGateway)
        .where(eq(outboundGateway.routeId, stitchId)),
    ]);
    return {
      data: rows,
      total: countResult[0]?.count ?? 0,
      page: safePage,
      limit: safeLimit,
    } satisfies ExplorerPage<(typeof rows)[number]>;
  }

  async listObjectsByStitch(
    orgId: string,
    stitchId: string,
    tab: string,
    workspaceId?: string,
  ): Promise<string[]> {
    const stitch = await this.resolveStitch(orgId, stitchId, workspaceId);
    const dataSourceId =
      tab === 'outbound' ? stitch.destDataSourceId : stitch.srcDataSourceId;

    const { schemaName, tenantId } =
      await this.storageResolver.resolveStorageProfile(dataSourceId);
    assertValidSchemaName(schemaName);
    const schema = buildTenantSchema(schemaName);
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    if (tab === 'inbound') {
      const validTraces = tenantDb
        .select({ traceId: schema.syncLog.traceId })
        .from(schema.syncLog)
        .where(eq(schema.syncLog.routeId, stitchId));
      const rows = await tenantDb
        .selectDistinct({ type: schema.inboundGateway.objectType })
        .from(schema.inboundGateway)
        .where(inArray(schema.inboundGateway.traceId, validTraces));
      return rows.map((r) => r.type ?? 'Uncategorized');
    }
    if (tab === 'replica') {
      const validTraces = tenantDb
        .select({ traceId: schema.syncLog.traceId })
        .from(schema.syncLog)
        .where(eq(schema.syncLog.routeId, stitchId));
      const rows = await tenantDb
        .selectDistinct({ type: schema.replicaEntity.entityType })
        .from(schema.replicaEntity)
        .where(inArray(schema.replicaEntity.traceId, validTraces));
      return rows.map((r) => r.type ?? 'Uncategorized');
    }
    if (tab === 'normalized') {
      const validTraces = tenantDb
        .select({ traceId: schema.syncLog.traceId })
        .from(schema.syncLog)
        .where(eq(schema.syncLog.routeId, stitchId));
      const rows = await tenantDb
        .selectDistinct({ type: schema.normalizedEntity.canonicalType })
        .from(schema.normalizedEntity)
        .where(inArray(schema.normalizedEntity.traceId, validTraces));
      return rows.map((r) => r.type ?? 'Uncategorized');
    }
    if (tab === 'entity-map') {
      const rows = await tenantDb
        .selectDistinct({ type: globalEntityMap.sourceEntityType })
        .from(globalEntityMap)
        .where(eq(globalEntityMap.stitchId, stitchId));
      return rows.map((r) => r.type ?? 'Uncategorized');
    }

    // outbound has no objectType
    return [];
  }
}
