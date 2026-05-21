import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { desc, eq, and, sql } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  integrationStitches,
  buildTenantSchema,
  assertValidSchemaName,
  globalEntityMap,
} from '@nexiom/database';
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

  // ── L1: Inbound Gateway ────────────────────────────────────────────────────

  async listInbound(
    orgId: string,
    stitchId: string,
    page: number,
    limit: number,
    workspaceId?: string,
  ) {
    const { safePage, safeLimit, offset } = this.safePagination(page, limit);
    const stitch = await this.resolveStitch(orgId, stitchId, workspaceId);
    const schemaName = await this.storageResolver.resolveSchemaName(
      stitch.srcDataSourceId,
    );
    assertValidSchemaName(schemaName);
    const { inboundGateway } = buildTenantSchema(schemaName);

    const [rows, countResult] = await Promise.all([
      this.db
        .select()
        .from(inboundGateway)
        .where(eq(inboundGateway.dataSourceId, stitch.srcDataSourceId))
        .orderBy(desc(inboundGateway.createdAt))
        .limit(safeLimit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(inboundGateway)
        .where(eq(inboundGateway.dataSourceId, stitch.srcDataSourceId)),
    ]);
    return {
      data: rows,
      total: countResult[0]?.count ?? 0,
      page: safePage,
      limit: safeLimit,
    } satisfies ExplorerPage<(typeof rows)[number]>;
  }

  // ── L2: Replica Entity ─────────────────────────────────────────────────────

  async listReplica(
    orgId: string,
    stitchId: string,
    page: number,
    limit: number,
    workspaceId?: string,
  ) {
    const { safePage, safeLimit, offset } = this.safePagination(page, limit);
    const stitch = await this.resolveStitch(orgId, stitchId, workspaceId);
    const schemaName = await this.storageResolver.resolveSchemaName(
      stitch.srcDataSourceId,
    );
    assertValidSchemaName(schemaName);
    const { replicaEntity } = buildTenantSchema(schemaName);

    const [rows, countResult] = await Promise.all([
      this.db
        .select()
        .from(replicaEntity)
        .where(eq(replicaEntity.dataSourceId, stitch.srcDataSourceId))
        .orderBy(desc(replicaEntity.updatedAt))
        .limit(safeLimit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(replicaEntity)
        .where(eq(replicaEntity.dataSourceId, stitch.srcDataSourceId)),
    ]);
    return {
      data: rows,
      total: countResult[0]?.count ?? 0,
      page: safePage,
      limit: safeLimit,
    } satisfies ExplorerPage<(typeof rows)[number]>;
  }

  // ── L3: Normalized Entity ──────────────────────────────────────────────────

  // NOTE: L3 normalized_entity is tenant-global (schema-scoped) and does not
  // have a direct dataSourceId column. It references replicaId which links back
  // to L2. This endpoint intentionally returns rows from all source connections
  // within the tenant schema. To filter by connection, join through replicaEntity.
  async listNormalized(
    orgId: string,
    stitchId: string,
    page: number,
    limit: number,
    workspaceId?: string,
  ) {
    const { safePage, safeLimit, offset } = this.safePagination(page, limit);
    const stitch = await this.resolveStitch(orgId, stitchId, workspaceId);
    const schemaName = await this.storageResolver.resolveSchemaName(
      stitch.srcDataSourceId,
    );
    assertValidSchemaName(schemaName);
    const { normalizedEntity } = buildTenantSchema(schemaName);

    const [rows, countResult] = await Promise.all([
      this.db
        .select()
        .from(normalizedEntity)
        .orderBy(desc(normalizedEntity.createdAt))
        .limit(safeLimit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(normalizedEntity),
    ]);
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

    const [rows, countResult] = await Promise.all([
      this.db
        .select()
        .from(outboundGateway)
        .where(eq(outboundGateway.routeId, stitchId))
        .orderBy(desc(outboundGateway.createdAt))
        .limit(safeLimit)
        .offset(offset),
      this.db
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
}
