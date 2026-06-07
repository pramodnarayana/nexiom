import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { sql, eq } from "drizzle-orm";
import type { DrizzleDb } from "@soopa/database";
import {
  buildTenantSchema,
  assertValidSchemaName,
  dataSources,
  integrationStitches,
} from "@soopa/database";
import {
  sanitizeError,
  sanitizeErrorObject,
} from "../../shared/pipeline.utils.js";
import { DeliveryService } from "./delivery.service.js";

@Injectable()
export class DeliveryRetryService {
  private readonly logger = new Logger(DeliveryRetryService.name);

  constructor(
    @Inject(forwardRef(() => DeliveryService))
    private readonly deliveryService: DeliveryService,
  ) {}

  /**
   * Check if source-side finalization completed for a given delivery.
   * Verifies that sync_log contains a SUCCESS/FAIL entry for this (traceId, routeId) at L6.
   */
  async isSourceFinalized(
    srcSchemaName: string,
    traceId: string,
    routeId: string,
    tenantDb: DrizzleDb,
  ): Promise<boolean> {
    try {
      const { syncLog } = buildTenantSchema(srcSchemaName);
      const logs = await tenantDb.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
        );
        return await tx
          .select()
          .from(syncLog)
          .where(
            sql`${syncLog.traceId} = ${traceId} AND ${syncLog.routeId} = ${routeId} AND ${syncLog.layer} = 'L6' AND ${syncLog.status} != 'RETRY'`,
          )
          .limit(1);
      });
      return logs.length > 0;
    } catch (err) {
      this.logger.error(
        {
          event: "l5.source_finalized_check_failed",
          traceId,
          routeId,
          layer: "L5",
          err: sanitizeErrorObject(err),
        },
        `Failed to check source finalization status — assuming incomplete: ${sanitizeError(err)}`,
      );
      return false;
    }
  }

  /**
   * Retry source-side finalization for a delivery that already completed (SUCCESS or FAIL)
   * but whose source-side write didn't finish.
   */
  async retrySourceFinalization(
    destSchemaName: string,
    srcSchemaName: string,
    outboundGatewayId: string,
    traceId: string,
    routeId: string,
    dataSourceId: string,
    targetConnectionId: string,
    finalStatus: "SUCCESS" | "FAIL",
    defaultStatusCode: number,
    canonicalType: string,
    srcAppName: string,
    srcTenantId: string,
    srcVendorId: string | undefined,
    start: number,
    tenantDb: DrizzleDb,
  ): Promise<boolean> {
    const { outboundGateway } = buildTenantSchema(destSchemaName);

    const existingResult = await tenantDb.transaction(async (tx) => {
      assertValidSchemaName(destSchemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
      );
      return await tx
        .select({
          response: outboundGateway.response,
          statusCode: outboundGateway.statusCode,
          destVendorId: outboundGateway.destVendorId,
        })
        .from(outboundGateway)
        .where(sql`${outboundGateway.id} = ${outboundGatewayId}`)
        .limit(1);
    });

    if (existingResult.length === 0) {
      throw new Error("Outbound gateway result not found for retry");
    }

    const connRows = await tenantDb
      .select({
        appName: dataSources.appName,
        tenantId: dataSources.tenantId,
      })
      .from(dataSources)
      .where(eq(dataSources.id, targetConnectionId))
      .limit(1);

    const targetAppName = connRows[0]?.appName;
    const targetTenantId = connRows[0]?.tenantId;

    const stitchDocs = await tenantDb
      .select()
      .from(integrationStitches)
      .where(sql`id = ${routeId}`)
      .limit(1);
    const targetObject = stitchDocs[0]?.targetObject ?? "";

    const resPayload = existingResult[0].response as Record<
      string,
      unknown
    > | null;
    const destVendorId = existingResult[0].destVendorId ?? undefined;

    return await this.deliveryService.writeL6Result(
      destSchemaName,
      srcSchemaName,
      outboundGatewayId,
      dataSourceId,
      traceId,
      routeId,
      resPayload,
      null, // sentPayload is unknown during a source-finalization retry
      existingResult[0].statusCode ?? defaultStatusCode,
      finalStatus,
      start,
      destVendorId,
      canonicalType,
      srcAppName,
      srcTenantId,
      srcVendorId,
      targetConnectionId,
      targetAppName,
      targetTenantId,
      targetObject,
      targetTenantId,
      tenantDb,
    );
  }
}
