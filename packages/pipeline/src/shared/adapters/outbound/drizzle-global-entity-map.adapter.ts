import { Injectable, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE_CONNECTION, globalEntityMap } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import { GlobalEntityMapRepositoryPort, GemMappingParams } from '../../ports/global-entity-map.repository.port.js';
import { DB_MANAGER, type DatabaseManager } from "@soopa/dbmanager";

@Injectable()
export class DrizzleGlobalEntityMapRepositoryAdapter implements GlobalEntityMapRepositoryPort {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) { }

  async getDestinationEntityId(
    tenantId: string,
    stitchId: string,
    sourceDataSourceId: string,
    sourceEntityId: string
  ): Promise<string | null> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    const gemMappings = await tenantDb
      .select()
      .from(globalEntityMap)
      .where(
        sql`${globalEntityMap.stitchId} = ${stitchId} AND ${globalEntityMap.sourceDataSourceId} = ${sourceDataSourceId} AND ${globalEntityMap.sourceEntityId} = ${sourceEntityId}`,
      )
      .limit(1);

    if (gemMappings.length > 0) {
      return gemMappings[0].destEntityId;
    }

    return null;
  }

  async writeGemMapping(
    tenantId: string,
    params: GemMappingParams,
  ): Promise<void> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    // global_entity_map is in the public schema of the tenant db
    // We don't need a search path for it
    await tenantDb
      .insert(globalEntityMap)
      .values({
        stitchId: params.routeId,
        sourceAppName: params.srcAppName,
        sourceDataSourceId: params.dataSourceId,
        sourceOrgId: params.srcOrganizationId,
        sourceEntityType: params.canonicalType,
        sourceEntityId: params.srcEntityId,
        sourceRefLayer: "L2",
        sourceTraceId: params.traceId,
        destAppName: params.targetAppName,
        destDataSourceId: params.targetConnectionId,
        destOrgId: params.targetOrganizationId,
        destEntityType: params.canonicalType,
        destEntityId: params.destEntityId,
        destRefLayer: "L6",
        destTraceId: params.traceId,
      })
      .onConflictDoUpdate({
        target: [
          globalEntityMap.stitchId,
          globalEntityMap.sourceDataSourceId,
          globalEntityMap.sourceEntityId,
          globalEntityMap.destDataSourceId,
          globalEntityMap.destEntityType,
        ],
        set: {
          destEntityId: params.destEntityId,
          destTraceId: params.traceId,
          lastSyncedAt: sql`NOW()`,
        },
      });
  }
}
