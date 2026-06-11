import { Injectable, Inject } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { eq, desc, and, isNotNull, sql } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  buildTenantSchema,
  assertValidSchemaName,
} from '@soopa/database';
import { buildDrizzleFilter } from './filter-parser.js';
import { StorageResolverService } from '@soopa/pipeline';
import { DB_MANAGER } from '@soopa/dbmanager';
import type { DatabaseManager } from '@soopa/dbmanager';
import { TraceService } from './trace.service.js';

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
    private readonly traceService: TraceService,
  ) {
    this.logger.setContext(DataExplorerService.name);
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

  // ── Connection-centric Data Explorer ───────────────────────────────────────

  async listConnectionInbound(
    _orgId: string,
    connectionId: string,
    page: number,
    limit: number,
    _workspaceId?: string,
    objectType?: string,
    filters?: import('./filter-parser.js').FilterGroup,
  ) {
    const { safePage, safeLimit, offset } = this.safePagination(page, limit);
    const storageProfile =
      await this.storageResolver.resolveStorageProfile(connectionId);
    const tenantDb = await this.dbManager.getTenantDb(storageProfile.tenantId);
    const schemaName =
      await this.storageResolver.resolveSchemaName(connectionId);
    assertValidSchemaName(schemaName);
    const { inboundGateway } = buildTenantSchema(schemaName);

    const filterWhere = buildDrizzleFilter(filters, inboundGateway);
    const finalWhere = and(
      eq(inboundGateway.dataSourceId, connectionId),
      objectType ? eq(inboundGateway.objectType, objectType) : undefined,
      filterWhere,
    );

    const [countRes, dataRes] = await Promise.all([
      tenantDb
        .select({ count: sql`count(*)` })
        .from(inboundGateway)
        .where(finalWhere),
      tenantDb
        .select()
        .from(inboundGateway)
        .where(finalWhere)
        .orderBy(desc(inboundGateway.createdAt))
        .limit(safeLimit)
        .offset(offset),
    ]);

    return {
      data: dataRes,
      total: Number(countRes[0]?.count ?? 0),
      page: safePage,
      limit: safeLimit,
    };
  }

  async listConnectionReplica(
    _orgId: string,
    connectionId: string,
    page: number,
    limit: number,
    _workspaceId?: string,
    objectType?: string,
    filters?: import('./filter-parser.js').FilterGroup,
  ) {
    const { safePage, safeLimit, offset } = this.safePagination(page, limit);
    const storageProfile =
      await this.storageResolver.resolveStorageProfile(connectionId);
    const tenantDb = await this.dbManager.getTenantDb(storageProfile.tenantId);
    const schemaName =
      await this.storageResolver.resolveSchemaName(connectionId);
    assertValidSchemaName(schemaName);
    const { replicaEntity } = buildTenantSchema(schemaName);

    const filterWhere = buildDrizzleFilter(filters, replicaEntity);
    const finalWhere = and(
      eq(replicaEntity.dataSourceId, connectionId),
      objectType ? eq(replicaEntity.entityType, objectType) : undefined,
      filterWhere,
    );

    const [countRes, dataRes] = await Promise.all([
      tenantDb
        .select({ count: sql`count(*)` })
        .from(replicaEntity)
        .where(finalWhere),
      tenantDb
        .select()
        .from(replicaEntity)
        .where(finalWhere)
        .orderBy(desc(replicaEntity.createdAt))
        .limit(safeLimit)
        .offset(offset),
    ]);

    return {
      data: dataRes,
      total: Number(countRes[0]?.count ?? 0),
      page: safePage,
      limit: safeLimit,
    };
  }

  async listConnectionNormalized(
    _orgId: string,
    connectionId: string,
    page: number,
    limit: number,
    _workspaceId?: string,
    objectType?: string,
    filters?: import('./filter-parser.js').FilterGroup,
  ) {
    const { safePage, safeLimit, offset } = this.safePagination(page, limit);
    const storageProfile =
      await this.storageResolver.resolveStorageProfile(connectionId);
    const tenantDb = await this.dbManager.getTenantDb(storageProfile.tenantId);
    const schemaName =
      await this.storageResolver.resolveSchemaName(connectionId);
    assertValidSchemaName(schemaName);
    const { normalizedEntity, replicaEntity } = buildTenantSchema(schemaName);

    const filterWhere = buildDrizzleFilter(filters, normalizedEntity);
    const finalWhere = and(
      eq(replicaEntity.dataSourceId, connectionId),
      objectType ? eq(replicaEntity.entityType, objectType) : undefined,
      filterWhere,
    );

    const [countRes, dataRes] = await Promise.all([
      tenantDb
        .select({ count: sql`count(*)` })
        .from(normalizedEntity)
        .innerJoin(
          replicaEntity,
          eq(normalizedEntity.replicaId, replicaEntity.id),
        )
        .where(finalWhere),
      tenantDb
        .select({
          id: normalizedEntity.id,
          traceId: normalizedEntity.traceId,
          replicaId: normalizedEntity.replicaId,
          canonicalType: normalizedEntity.canonicalType,
          data: normalizedEntity.data,
          createdAt: normalizedEntity.createdAt,
        })
        .from(normalizedEntity)
        .innerJoin(
          replicaEntity,
          eq(normalizedEntity.replicaId, replicaEntity.id),
        )
        .where(finalWhere)
        .orderBy(desc(normalizedEntity.createdAt))
        .limit(safeLimit)
        .offset(offset),
    ]);

    return {
      data: dataRes,
      total: Number(countRes[0]?.count ?? 0),
      page: safePage,
      limit: safeLimit,
    };
  }

  async listConnectionOutbound(
    _orgId: string,
    connectionId: string,
    page: number,
    limit: number,
    _workspaceId?: string,
  ) {
    const { safePage, safeLimit, offset } = this.safePagination(page, limit);
    const storageProfile =
      await this.storageResolver.resolveStorageProfile(connectionId);
    const tenantDb = await this.dbManager.getTenantDb(storageProfile.tenantId);
    const schemaName =
      await this.storageResolver.resolveSchemaName(connectionId);
    assertValidSchemaName(schemaName);
    const { outboundGateway } = buildTenantSchema(schemaName);

    const [countRes, dataRes] = await Promise.all([
      tenantDb
        .select({ count: sql`count(*)` })
        .from(outboundGateway)
        .where(eq(outboundGateway.dataSourceId, connectionId)),
      tenantDb
        .select()
        .from(outboundGateway)
        .where(eq(outboundGateway.dataSourceId, connectionId))
        .orderBy(desc(outboundGateway.createdAt))
        .limit(safeLimit)
        .offset(offset),
    ]);

    return {
      data: dataRes,
      total: Number(countRes[0]?.count ?? 0),
      page: safePage,
      limit: safeLimit,
    };
  }

  async getConnectionTrace(
    _orgId: string,
    connectionId: string,
    traceId: string,
  ) {
    const storageProfile =
      await this.storageResolver.resolveStorageProfile(connectionId);
    const schemaName =
      await this.storageResolver.resolveSchemaName(connectionId);
    assertValidSchemaName(schemaName);
    const tenantDb = await this.dbManager.getTenantDb(storageProfile.tenantId);
    const schema = buildTenantSchema(schemaName);

    const [l1, l2, l3, l6] = await Promise.all([
      tenantDb
        .select()
        .from(schema.inboundGateway)
        .where(
          and(
            eq(schema.inboundGateway.traceId, traceId),
            eq(schema.inboundGateway.dataSourceId, connectionId),
          ),
        )
        .limit(1),
      tenantDb
        .select()
        .from(schema.replicaEntity)
        .where(
          and(
            eq(schema.replicaEntity.traceId, traceId),
            eq(schema.replicaEntity.dataSourceId, connectionId),
          ),
        )
        .limit(1),
      tenantDb
        .select()
        .from(schema.normalizedEntity)
        .where(eq(schema.normalizedEntity.traceId, traceId))
        .limit(1),
      tenantDb
        .select()
        .from(schema.outboundGateway)
        .where(
          and(
            eq(schema.outboundGateway.traceId, traceId),
            eq(schema.outboundGateway.dataSourceId, connectionId),
          ),
        )
        .limit(1),
    ]);

    return {
      inbound: l1[0] || null,
      replica: l2[0] || null,
      normalized: l3[0] || null,
      outbound: l6[0] || null,
    };
  }

  async listTraceRoutes(_orgId: string, connectionId: string, traceId: string) {
    const { schemaName, tenantId } =
      await this.storageResolver.resolveStorageProfile(connectionId);
    assertValidSchemaName(schemaName);
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    const { syncLog } = buildTenantSchema(schemaName);

    // List all destinations for this trace from the sync log
    const routes = await tenantDb
      .select({ routeId: syncLog.routeId })
      .from(syncLog)
      .where(and(eq(syncLog.traceId, traceId), isNotNull(syncLog.routeId)));

    return routes.map((r) => r.routeId);
  }

  async listObjectsByConnection(
    _orgId: string,
    connectionId: string,
    tab: string,
    _workspaceId?: string,
  ): Promise<string[]> {
    const { schemaName, tenantId } =
      await this.storageResolver.resolveStorageProfile(connectionId);
    assertValidSchemaName(schemaName);
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    const schema = buildTenantSchema(schemaName);

    if (tab === 'inbound') {
      const rows = await tenantDb
        .selectDistinct({ type: schema.inboundGateway.objectType })
        .from(schema.inboundGateway)
        .where(
          and(
            eq(schema.inboundGateway.dataSourceId, connectionId),
            isNotNull(schema.inboundGateway.objectType),
          ),
        );
      return rows.map((r) => r.type ?? 'Uncategorized');
    }
    if (tab === 'replica') {
      const rows = await tenantDb
        .selectDistinct({ type: schema.replicaEntity.entityType })
        .from(schema.replicaEntity)
        .where(eq(schema.replicaEntity.dataSourceId, connectionId));
      return rows.map((r) => r.type ?? 'Uncategorized');
    }
    if (tab === 'normalized') {
      const rows = await tenantDb
        .selectDistinct({ type: schema.normalizedEntity.canonicalType })
        .from(schema.normalizedEntity);
      return rows.map((r) => r.type ?? 'Uncategorized');
    }

    return [];
  }
}
