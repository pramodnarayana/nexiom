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
  ): Promise<ExplorerPage<Record<string, unknown>>> {
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
  ): Promise<ExplorerPage<Record<string, unknown>>> {
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

    const [countRes, dataResRaw] = await Promise.all([
      tenantDb
        .select({ count: sql`count(*)` })
        .from(replicaEntity)
        .where(finalWhere),
      tenantDb
        .select({
          replica: replicaEntity,
          normalizedId: buildTenantSchema(schemaName).normalizedEntity.id,
        })
        .from(replicaEntity)
        .leftJoin(
          buildTenantSchema(schemaName).normalizedEntity,
          eq(
            replicaEntity.id,
            buildTenantSchema(schemaName).normalizedEntity.replicaId,
          ),
        )
        .where(finalWhere)
        .orderBy(desc(replicaEntity.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const dataRes = dataResRaw.map((row) => ({
      ...row.replica,
      status: row.normalizedId ? 'NORMALIZED' : 'PENDING',
    }));

    return {
      data: dataRes,
      total: Number(countRes[0]?.count ?? 0),
      page,
      limit,
    };
  }

  private readonly polymorphicStrategies: Record<
    string,
    (
      tenantDb: DrizzleDb,
      schemaName: string,
      connectionId: string,
      page: number,
      limit: number,
      objectType?: string,
    ) => Promise<ExplorerPage<Record<string, unknown>>>
  > = {
    raw: (db, schema, connId, p, l, obj) =>
      this.queryPolymorphicNormalizedEntities(
        db,
        schema,
        connId,
        p,
        l,
        obj,
        'RAW',
      ),
    all: (db, schema, connId, p, l, obj) =>
      this.queryPolymorphicNormalizedEntities(
        db,
        schema,
        connId,
        p,
        l,
        obj,
        undefined,
      ),
  };

  async listConnectionNormalized(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    page: number,
    limit: number,
    objectType?: string,
    _filters?: import('../../filter-parser.js').FilterGroup,
    canonicalType?: string,
  ): Promise<ExplorerPage<Record<string, unknown>>> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    assertValidSchemaName(schemaName);

    const tableName = await this.resolveTableName(
      tenantDb,
      schemaName,
      connectionId,
      objectType,
      canonicalType,
    );
    if (!tableName) {
      return { data: [], total: 0, page, limit };
    }

    const strategy = this.polymorphicStrategies[tableName];
    if (strategy) {
      return strategy(
        tenantDb,
        schemaName,
        connectionId,
        page,
        limit,
        objectType,
      );
    }

    return this.queryCanonicalTable(
      tenantDb,
      schemaName,
      tableName,
      connectionId,
      page,
      limit,
    );
  }

  private async resolveTableName(
    tenantDb: DrizzleDb,
    schemaName: string,
    connectionId: string,
    objectType?: string,
    canonicalType?: string,
  ): Promise<string | null> {
    if (canonicalType === 'ALL') return 'all';
    if (canonicalType) return canonicalType.toLowerCase();
    if (!objectType) return null;

    const { replicaEntity, normalizedEntity } = buildTenantSchema(schemaName);
    const mappingRes = await tenantDb
      .select({ canonicalType: normalizedEntity.canonicalType })
      .from(normalizedEntity)
      .innerJoin(
        replicaEntity,
        eq(normalizedEntity.replicaId, replicaEntity.id),
      )
      .where(
        and(
          eq(replicaEntity.dataSourceId, connectionId),
          eq(replicaEntity.entityType, objectType),
        ),
      )
      .limit(1);

    return mappingRes.length > 0 && mappingRes[0].canonicalType
      ? mappingRes[0].canonicalType.toLowerCase()
      : null;
  }

  private async queryPolymorphicNormalizedEntities(
    tenantDb: DrizzleDb,
    schemaName: string,
    connectionId: string,
    page: number,
    limit: number,
    objectType?: string,
    exactCanonicalType?: string,
  ): Promise<ExplorerPage<Record<string, unknown>>> {
    const offset = (page - 1) * limit;

    const countQuery = objectType
      ? exactCanonicalType
        ? sql`
            SELECT count(*) as count
            FROM ${sql.identifier(schemaName)}.normalized_entity n
            INNER JOIN ${sql.identifier(schemaName)}.replica_entity r ON n.replica_id = r.id
            WHERE r.data_source_id = ${connectionId}
              AND r.entity_type = ${objectType}
              AND n.canonical_type = ${exactCanonicalType}
          `
        : sql`
            SELECT count(*) as count
            FROM ${sql.identifier(schemaName)}.normalized_entity n
            INNER JOIN ${sql.identifier(schemaName)}.replica_entity r ON n.replica_id = r.id
            WHERE r.data_source_id = ${connectionId}
              AND r.entity_type = ${objectType}
          `
      : exactCanonicalType
        ? sql`
            SELECT count(*) as count
            FROM ${sql.identifier(schemaName)}.normalized_entity n
            INNER JOIN ${sql.identifier(schemaName)}.replica_entity r ON n.replica_id = r.id
            WHERE r.data_source_id = ${connectionId}
              AND n.canonical_type = ${exactCanonicalType}
          `
        : sql`
            SELECT count(*) as count
            FROM ${sql.identifier(schemaName)}.normalized_entity n
            INNER JOIN ${sql.identifier(schemaName)}.replica_entity r ON n.replica_id = r.id
            WHERE r.data_source_id = ${connectionId}
          `;

    const dataQuery = objectType
      ? exactCanonicalType
        ? sql`
            SELECT n.id, n.trace_id, n.replica_id, n.canonical_type, n.data, n.created_at, n.updated_at
            FROM ${sql.identifier(schemaName)}.normalized_entity n
            INNER JOIN ${sql.identifier(schemaName)}.replica_entity r ON n.replica_id = r.id
            WHERE r.data_source_id = ${connectionId}
              AND r.entity_type = ${objectType}
              AND n.canonical_type = ${exactCanonicalType}
            ORDER BY n.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
          `
        : sql`
            SELECT n.id, n.trace_id, n.replica_id, n.canonical_type, n.data, n.created_at, n.updated_at
            FROM ${sql.identifier(schemaName)}.normalized_entity n
            INNER JOIN ${sql.identifier(schemaName)}.replica_entity r ON n.replica_id = r.id
            WHERE r.data_source_id = ${connectionId}
              AND r.entity_type = ${objectType}
            ORDER BY n.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
          `
      : exactCanonicalType
        ? sql`
            SELECT n.id, n.trace_id, n.replica_id, n.canonical_type, n.data, n.created_at, n.updated_at
            FROM ${sql.identifier(schemaName)}.normalized_entity n
            INNER JOIN ${sql.identifier(schemaName)}.replica_entity r ON n.replica_id = r.id
            WHERE r.data_source_id = ${connectionId}
              AND n.canonical_type = ${exactCanonicalType}
            ORDER BY n.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
          `
        : sql`
            SELECT n.id, n.trace_id, n.replica_id, n.canonical_type, n.data, n.created_at, n.updated_at
            FROM ${sql.identifier(schemaName)}.normalized_entity n
            INNER JOIN ${sql.identifier(schemaName)}.replica_entity r ON n.replica_id = r.id
            WHERE r.data_source_id = ${connectionId}
            ORDER BY n.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
          `;

    const [countRes, dataRes] = await Promise.all([
      tenantDb.execute(countQuery),
      tenantDb.execute(dataQuery),
    ]);

    const extractRows = (res: unknown): Record<string, unknown>[] => {
      if (Array.isArray(res)) return res as Record<string, unknown>[];
      if (
        res &&
        typeof res === 'object' &&
        'rows' in res &&
        Array.isArray((res as { rows: unknown[] }).rows)
      ) {
        return (res as { rows: Record<string, unknown>[] }).rows;
      }
      return [];
    };

    const countRows = extractRows(countRes);
    const dataRows = extractRows(dataRes);

    return {
      data: dataRows,
      total: Number(countRows[0]?.count ?? 0),
      page,
      limit,
    };
  }

  private async queryCanonicalTable(
    tenantDb: DrizzleDb,
    schemaName: string,
    tableName: string,
    connectionId: string,
    page: number,
    limit: number,
  ): Promise<ExplorerPage<Record<string, unknown>>> {
    if (!/^[a-z0-9_]+$/.test(tableName)) {
      throw new Error(`Invalid table name: ${tableName}`);
    }

    const offset = (page - 1) * limit;
    const countQuery = sql`
      SELECT count(*) as count
      FROM ${sql.identifier(schemaName)}.${sql.identifier(tableName)}
      WHERE data_source_id = ${connectionId}
    `;

    const dataQuery = sql`
      SELECT *
      FROM ${sql.identifier(schemaName)}.${sql.identifier(tableName)}
      WHERE data_source_id = ${connectionId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [countRes, dataRes] = await Promise.all([
      tenantDb.execute(countQuery),
      tenantDb.execute(dataQuery),
    ]);

    const extractRows = (res: unknown): Record<string, unknown>[] => {
      if (Array.isArray(res)) return res as Record<string, unknown>[];
      if (
        res &&
        typeof res === 'object' &&
        'rows' in res &&
        Array.isArray((res as { rows: unknown[] }).rows)
      ) {
        return (res as { rows: Record<string, unknown>[] }).rows;
      }
      return [];
    };

    const countRows = extractRows(countRes);
    const dataRows = extractRows(dataRes);

    return {
      data: dataRows,
      total: Number(countRows[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async listNormalizedTypes(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    objectType: string,
  ): Promise<string[]> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    assertValidSchemaName(schemaName);
    const { replicaEntity, normalizedEntity } = buildTenantSchema(schemaName);

    const mappingRes = await tenantDb
      .selectDistinct({ canonicalType: normalizedEntity.canonicalType })
      .from(normalizedEntity)
      .innerJoin(
        replicaEntity,
        eq(normalizedEntity.replicaId, replicaEntity.id),
      )
      .where(
        and(
          eq(replicaEntity.dataSourceId, connectionId),
          eq(replicaEntity.entityType, objectType),
        ),
      );

    return mappingRes.map((row) => row.canonicalType).filter(Boolean);
  }

  async listConnectionOutbound(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    page: number,
    limit: number,
  ): Promise<ExplorerPage<Record<string, unknown>>> {
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
        .select({
          id: schema.normalizedEntity.id,
          traceId: schema.normalizedEntity.traceId,
          replicaId: schema.normalizedEntity.replicaId,
          canonicalType: schema.normalizedEntity.canonicalType,
          data: schema.normalizedEntity.data,
          createdAt: schema.normalizedEntity.createdAt,
        })
        .from(schema.normalizedEntity)
        .innerJoin(
          schema.replicaEntity,
          eq(schema.normalizedEntity.replicaId, schema.replicaEntity.id),
        )
        .where(
          and(
            eq(schema.normalizedEntity.traceId, traceId),
            eq(schema.replicaEntity.dataSourceId, connectionId),
          ),
        )
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

  private readonly objectTypeStrategies: Record<
    string,
    (
      tenantDb: DrizzleDb,
      schema: ReturnType<typeof buildTenantSchema>,
      connectionId: string,
    ) => Promise<string[]>
  > = {
    inbound: async (tenantDb, schema, connectionId) => {
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
    },
    replica: async (tenantDb, schema, connectionId) => {
      const rows = await tenantDb
        .selectDistinct({ type: schema.replicaEntity.entityType })
        .from(schema.replicaEntity)
        .where(eq(schema.replicaEntity.dataSourceId, connectionId));
      return rows.map((r) => r.type ?? 'Uncategorized');
    },
    normalized: async (tenantDb, schema, connectionId) => {
      const rows = await tenantDb
        .selectDistinct({ type: schema.normalizedEntity.canonicalType })
        .from(schema.normalizedEntity)
        .innerJoin(
          schema.replicaEntity,
          eq(schema.normalizedEntity.replicaId, schema.replicaEntity.id),
        )
        .where(eq(schema.replicaEntity.dataSourceId, connectionId));
      return rows.map((r) => (r.type ? r.type.toLowerCase() : 'Uncategorized'));
    },
  };

  async listObjectsByConnection(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    tab: string,
  ): Promise<string[]> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    assertValidSchemaName(schemaName);
    const schema = buildTenantSchema(schemaName);

    const strategy = this.objectTypeStrategies[tab];
    if (strategy) {
      return strategy(tenantDb, schema, connectionId);
    }

    return [];
  }
}
