import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "@soopa/database";
import { globalEntityMap } from "@soopa/database";

export interface GemMappingParams {
  traceId: string;
  routeId: string;
  srcAppName: string;
  dataSourceId: string;
  srcTenantId: string;
  canonicalType: string;
  srcVendorId: string;
  targetAppName: string;
  targetConnectionId: string;
  targetTenantId: string;
  destVendorId: string;
}

@Injectable()
export class GemHydrationService {
  private readonly logger = new Logger(GemHydrationService.name);

  async writeGemMapping(
    tenantDb: DrizzleDb,
    params: GemMappingParams,
  ): Promise<void> {
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

    this.logger.log(
      {
        event: "gem.mapped",
        traceId: params.traceId,
        routeId: params.routeId,
        sourceAppName: params.srcAppName,
        sourceEntityId: params.srcVendorId,
        destAppName: params.targetAppName,
        destEntityId: params.destVendorId,
      },
      `Successfully wrote GEM linkage: ${params.srcAppName}[${params.srcVendorId}] -> ${params.targetAppName}[${params.destVendorId}]`,
    );
  }
}
