import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { desc, eq, and, sql } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  integrationStitches,
  globalEntityMap,
  buildTenantSchema,
  assertValidSchemaName,
} from '@nexiom/database';
import { StorageResolverService } from '@nexiom/engine';

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
      columns: { id: true, srcConnectionId: true, destConnectionId: true },
    });
    if (!stitch) throw new NotFoundException(`Stitch ${stitchId} not found`);
    return stitch;
  }

  private safePagination(page: number, limit: number) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
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
      stitch.srcConnectionId,
    );
    assertValidSchemaName(schemaName);
    const { inboundGateway } = buildTenantSchema(schemaName);

    return this.db.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      const [rows, countResult] = await Promise.all([
        tx
          .select()
          .from(inboundGateway)
          .where(eq(inboundGateway.connectionId, stitch.srcConnectionId))
          .orderBy(desc(inboundGateway.createdAt))
          .limit(safeLimit)
          .offset(offset),
        tx
          .select({ count: sql<number>`count(*)::int` })
          .from(inboundGateway)
          .where(eq(inboundGateway.connectionId, stitch.srcConnectionId)),
      ]);
      return {
        data: rows,
        total: countResult[0]?.count ?? 0,
        page: safePage,
        limit: safeLimit,
      } satisfies ExplorerPage<(typeof rows)[number]>;
    });
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
      stitch.srcConnectionId,
    );
    assertValidSchemaName(schemaName);
    const { replicaEntity } = buildTenantSchema(schemaName);

    return this.db.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      const [rows, countResult] = await Promise.all([
        tx
          .select()
          .from(replicaEntity)
          .where(eq(replicaEntity.connectionId, stitch.srcConnectionId))
          .orderBy(desc(replicaEntity.updatedAt))
          .limit(safeLimit)
          .offset(offset),
        tx
          .select({ count: sql<number>`count(*)::int` })
          .from(replicaEntity)
          .where(eq(replicaEntity.connectionId, stitch.srcConnectionId)),
      ]);
      return {
        data: rows,
        total: countResult[0]?.count ?? 0,
        page: safePage,
        limit: safeLimit,
      } satisfies ExplorerPage<(typeof rows)[number]>;
    });
  }

  // ── L3: Normalized Entity ──────────────────────────────────────────────────

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
      stitch.srcConnectionId,
    );
    assertValidSchemaName(schemaName);
    const { normalizedEntity } = buildTenantSchema(schemaName);

    return this.db.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      const [rows, countResult] = await Promise.all([
        tx
          .select()
          .from(normalizedEntity)
          .orderBy(desc(normalizedEntity.createdAt))
          .limit(safeLimit)
          .offset(offset),
        tx.select({ count: sql<number>`count(*)::int` }).from(normalizedEntity),
      ]);
      return {
        data: rows,
        total: countResult[0]?.count ?? 0,
        page: safePage,
        limit: safeLimit,
      } satisfies ExplorerPage<(typeof rows)[number]>;
    });
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
    await this.resolveStitch(orgId, stitchId, workspaceId);

    const [rows, countResult] = await Promise.all([
      this.db
        .select()
        .from(globalEntityMap)
        .where(eq(globalEntityMap.stitchId, stitchId))
        .orderBy(desc(globalEntityMap.lastSyncedAt))
        .limit(safeLimit)
        .offset(offset),
      this.db
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
      stitch.destConnectionId,
    );
    assertValidSchemaName(schemaName);
    const { outboundGateway } = buildTenantSchema(schemaName);

    return this.db.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      const [rows, countResult] = await Promise.all([
        tx
          .select()
          .from(outboundGateway)
          .where(eq(outboundGateway.routeId, stitchId))
          .orderBy(desc(outboundGateway.createdAt))
          .limit(safeLimit)
          .offset(offset),
        tx
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
    });
  }
}
