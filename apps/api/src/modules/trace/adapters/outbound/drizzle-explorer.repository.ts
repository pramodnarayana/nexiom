import { Injectable, Inject } from '@nestjs/common';
import type {
  ExplorerRepositoryPort,
  ExplorerPage,
} from '../../core/ports/outbound/explorer-repository.port.js';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  buildTenantSchema,
  assertValidSchemaName,
} from '@soopa/database';
import { DB_MANAGER } from '@soopa/dbmanager';
import type { DatabaseManager } from '@soopa/dbmanager';
import { sql, eq, desc, and, isNotNull } from 'drizzle-orm';
import { buildDrizzleFilter } from '../../filter-parser.js';

@Injectable()
export class DrizzleExplorerRepositoryAdapter implements ExplorerRepositoryPort {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  async listConnectionInbound(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    page: number,
    limit: number,
    objectType?: string,
    filters?: import('../../filter-parser.js').FilterGroup,
  ): Promise<ExplorerPage<any>> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    assertValidSchemaName(schemaName);
    const { inboundGateway } = buildTenantSchema(schemaName);

    const filterWhere = buildDrizzleFilter(filters, inboundGateway);
    const finalWhere = and(
      eq(inboundGateway.dataSourceId, connectionId),
      objectType ? eq(inboundGateway.objectType, objectType) : undefined,
      filterWhere,
    );

    const offset = (page - 1) * limit;

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
        .limit(limit)
        .offset(offset),
    ]);

    return {
      data: dataRes,
      total: Number(countRes[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async listConnectionReplica(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    page: number,
    limit: number,
    objectType?: string,
    filters?: import('../../filter-parser.js').FilterGroup,
  ): Promise<ExplorerPage<any>> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    assertValidSchemaName(schemaName);
    const { replicaEntity } = buildTenantSchema(schemaName);

    const filterWhere = buildDrizzleFilter(filters, replicaEntity);
    const finalWhere = and(
      eq(replicaEntity.dataSourceId, connectionId),
      objectType ? eq(replicaEntity.entityType, objectType) : undefined,
      filterWhere,
    );

    const offset = (page - 1) * limit;

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
        .limit(limit)
        .offset(offset),
    ]);

    return {
      data: dataRes,
      total: Number(countRes[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async listConnectionNormalized(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    page: number,
    limit: number,
    objectType?: string,
    filters?: import('../../filter-parser.js').FilterGroup,
  ): Promise<ExplorerPage<any>> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    assertValidSchemaName(schemaName);
    const { normalizedEntity, replicaEntity } = buildTenantSchema(schemaName);

    const filterWhere = buildDrizzleFilter(filters, normalizedEntity);
    const finalWhere = and(
      eq(replicaEntity.dataSourceId, connectionId),
      objectType ? eq(normalizedEntity.canonicalType, objectType) : undefined,
      filterWhere,
    );

    const offset = (page - 1) * limit;

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
        .limit(limit)
        .offset(offset),
    ]);

    return {
      data: dataRes,
      total: Number(countRes[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async listConnectionOutbound(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    page: number,
    limit: number,
  ): Promise<ExplorerPage<any>> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    assertValidSchemaName(schemaName);
    const { outboundGateway } = buildTenantSchema(schemaName);

    const offset = (page - 1) * limit;

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
        .limit(limit)
        .offset(offset),
    ]);

    return {
      data: dataRes,
      total: Number(countRes[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async getConnectionTrace(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    traceId: string,
  ): Promise<{
    inbound: unknown;
    replica: unknown;
    normalized: unknown;
    outbound: unknown;
  }> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    assertValidSchemaName(schemaName);
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

  async listTraceRoutes(
    tenantId: string,
    schemaName: string,
    traceId: string,
  ): Promise<string[]> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    assertValidSchemaName(schemaName);
    const { syncLog } = buildTenantSchema(schemaName);

    const routes = await tenantDb
      .selectDistinct({ routeId: syncLog.routeId })
      .from(syncLog)
      .where(and(eq(syncLog.traceId, traceId), isNotNull(syncLog.routeId)));

    return routes.map((r) => r.routeId!);
  }

  async listObjectsByConnection(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    tab: string,
  ): Promise<string[]> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    assertValidSchemaName(schemaName);
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
        .from(schema.normalizedEntity)
        .innerJoin(
          schema.replicaEntity,
          eq(schema.normalizedEntity.replicaId, schema.replicaEntity.id),
        )
        .where(eq(schema.replicaEntity.dataSourceId, connectionId));
      return rows.map((r) => r.type ?? 'Uncategorized');
    }

    return [];
  }
}
