import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "@soopa/database";
import { globalEntityMap } from "@soopa/database";

@Injectable()
export class GemHydrationService {
  private readonly logger = new Logger(GemHydrationService.name);

  async writeGemMapping(
    tenantDb: DrizzleDb,
    traceId: string,
    routeId: string,
    srcAppName: string,
    dataSourceId: string,
    srcTenantId: string,
    canonicalType: string,
    srcVendorId: string,
    targetAppName: string,
    targetConnectionId: string,
    targetTenantId: string,
    destVendorId: string,
  ): Promise<void> {
    await tenantDb
      .insert(globalEntityMap)
      .values({
        stitchId: routeId,
        sourceAppName: srcAppName,
        sourceDataSourceId: dataSourceId,
        sourceOrgId: srcTenantId,
        sourceEntityType: canonicalType,
        sourceEntityId: srcVendorId,
        sourceRefLayer: "L2",
        sourceTraceId: traceId,
        destAppName: targetAppName,
        destDataSourceId: targetConnectionId,
        destOrgId: targetTenantId,
        destEntityType: canonicalType,
        destEntityId: destVendorId,
        destRefLayer: "L6",
        destTraceId: traceId,
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
          destEntityId: destVendorId,
          destTraceId: traceId,
          lastSyncedAt: sql`NOW()`,
        },
      });

    this.logger.log(
      {
        event: "gem.mapped",
        traceId,
        routeId,
        sourceAppName: srcAppName,
        sourceEntityId: srcVendorId,
        destAppName: targetAppName,
        destEntityId: destVendorId,
      },
      `Successfully wrote GEM linkage: ${srcAppName}[${srcVendorId}] -> ${targetAppName}[${destVendorId}]`,
    );
  }
}
