import { Injectable, Inject } from "@nestjs/common";
import { sql, and, eq, inArray } from "drizzle-orm";
import { DATABASE_CONNECTION, type DrizzleDb, tenantStorageRegistry, dataSources, integrationStitches, buildTenantSchema } from "@soopa/database";
import { DependencySweeperRepositoryPort, ActiveConnectionWithStitch } from '../../ports/dependency-sweeper.repository.port.js';
import { DB_MANAGER, type DatabaseManager } from "@soopa/dbmanager";

@Injectable()
export class DrizzleDependencySweeperRepositoryAdapter implements DependencySweeperRepositoryPort {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  async getActiveTenants(): Promise<{ tenantId: string }[]> {
    return await this.globalDb
      .select({ tenantId: tenantStorageRegistry.tenantId })
      .from(tenantStorageRegistry)
      .where(eq(tenantStorageRegistry.status, "ACTIVE"));
  }

  async getConnectionsWithActiveStitches(): Promise<ActiveConnectionWithStitch[]> {
    return await this.globalDb
      .selectDistinct({
        id: dataSources.id,
        appName: dataSources.appName,
        tenantId: dataSources.tenantId,
        organizationId: dataSources.organizationId,
        schemaName: dataSources.schemaName,
      })
      .from(dataSources)
      .innerJoin(
        integrationStitches,
        eq(integrationStitches.destDataSourceId, dataSources.id),
      )
      .where(
        and(
          eq(integrationStitches.status, "ACTIVE"),
          sql`${dataSources.schemaPlan} IN ('SCHEMA_ACTIVE')`,
        ),
      );
  }

  async getDeferredTraces(tenantId: string, schemaName: string, olderThanMinutes: number): Promise<{ traceId: string; routeId: string }[]> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    const { outboundGateway } = buildTenantSchema(schemaName);

    return await tenantDb
      .select({ traceId: outboundGateway.traceId, routeId: outboundGateway.routeId })
      .from(outboundGateway)
      .where(
        and(
          eq(outboundGateway.status, "DEFERRED_DEPENDENCY"),
          sql`${outboundGateway.updatedAt} < NOW() - INTERVAL '${sql.raw(olderThanMinutes.toString())} minutes'`,
        ),
      );
  }

  async getReplicaDataSources(tenantId: string, schemaName: string, traceIds: string[]): Promise<{ traceId: string; dataSourceId: string }[]> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    const { replicaEntity } = buildTenantSchema(schemaName);

    return await tenantDb
      .select({
        traceId: replicaEntity.traceId,
        dataSourceId: replicaEntity.dataSourceId,
      })
      .from(replicaEntity)
      .where(inArray(replicaEntity.traceId, traceIds));
  }

  async claimDeferredTrace(tenantId: string, schemaName: string, traceId: string, routeId: string): Promise<boolean> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    const { outboundGateway } = buildTenantSchema(schemaName);

    const updateResult = await tenantDb
      .update(outboundGateway)
      .set({ status: "PENDING", updatedAt: sql`NOW()` })
      .where(
        and(
          eq(outboundGateway.traceId, traceId),
          eq(outboundGateway.routeId, routeId),
          eq(outboundGateway.status, "DEFERRED_DEPENDENCY"),
        ),
      )
      .returning({ id: outboundGateway.id });

    return updateResult.length > 0;
  }

  async unclaimDeferredTrace(tenantId: string, schemaName: string, traceId: string, routeId: string): Promise<boolean> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    const { outboundGateway } = buildTenantSchema(schemaName);

    const updateResult = await tenantDb
      .update(outboundGateway)
      .set({ status: "DEFERRED_DEPENDENCY", updatedAt: sql`NOW()` })
      .where(
        and(
          eq(outboundGateway.traceId, traceId),
          eq(outboundGateway.routeId, routeId),
          eq(outboundGateway.status, "PENDING"),
        ),
      )
      .returning({ id: outboundGateway.id });

    return updateResult.length > 0;
  }
}
