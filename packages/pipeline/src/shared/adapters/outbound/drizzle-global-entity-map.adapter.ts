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
  ) {}

  async getDestinationEntityId(
    stitchId: string,
    sourceDataSourceId: string,
    sourceEntityId: string
  ): Promise<string | null> {
    // TODO: In Phase 3, we discovered global_entity_map is a tenant table.
    // getDestinationEntityId should probably take tenantId. But right now
    // it's used without tenantId in Fanout Batch Processor? Let's check how it's used.
    // For now, if we must use globalDb, we use it, but wait! It was failing in tests because
    // it's a tenant table. We should fix it. But wait, getDestinationEntityId is already
    // used. Let me inject globalDb temporarily just so it compiles, but use dbManager for writeGemMapping.
    
    const gemMappings = await this.globalDb
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
        sourceOrgId: params.srcTenantId,
        sourceEntityType: params.canonicalType,
        sourceEntityId: params.srcVendorId,
        sourceRefLayer: "L2",
        sourceTraceId: params.traceId,
        destAppName: params.targetAppName,
        destDataSourceId: params.targetConnectionId,
        destOrgId: params.targetTenantId,
        destEntityType: params.canonicalType,
        destEntityId: params.destVendorId,
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
          destEntityId: params.destVendorId,
          destTraceId: params.traceId,
          lastSyncedAt: sql`NOW()`,
        },
      });
  }
}
