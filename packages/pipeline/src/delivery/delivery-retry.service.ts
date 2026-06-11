import { Injectable, Logger, Inject } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import {
  sanitizeError,
  sanitizeErrorObject,
} from "../utils.js";
import { DeliveryService } from "./delivery.service.js";
import { SyncLogRepositoryPort } from "../shared/ports/sync-log.repository.port.js";
import { ConnectionRepositoryPort } from "../shared/ports/connection.repository.port.js";
import { StitchRepositoryPort } from "../shared/ports/stitch.repository.port.js";
import { OutboundGatewayRepositoryPort } from "../shared/ports/outbound-gateway.repository.port.js";

@Injectable()
export class DeliveryRetryService {
  private readonly logger = new Logger(DeliveryRetryService.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject("SyncLogRepositoryPort")
    private readonly syncLogRepository: SyncLogRepositoryPort,
    @Inject("ConnectionRepositoryPort")
    private readonly connectionRepository: ConnectionRepositoryPort,
    @Inject("StitchRepositoryPort")
    private readonly stitchRepository: StitchRepositoryPort,
    @Inject("OutboundGatewayRepositoryPort")
    private readonly outboundGatewayRepository: OutboundGatewayRepositoryPort,
  ) {}

  private get deliveryService(): DeliveryService {
    return this.moduleRef.get(DeliveryService, { strict: false });
  }

  /**
   * Check if source-side finalization completed for a given delivery.
   * Verifies that sync_log contains a SUCCESS/FAIL entry for this (traceId, routeId) at L6.
   */
  async isSourceFinalized(
    tenantId: string,
    srcSchemaName: string,
    traceId: string,
    routeId: string,
  ): Promise<boolean> {
    try {
      return await this.syncLogRepository.hasCompletedSyncLog(
        tenantId,
        srcSchemaName,
        traceId,
        routeId,
        'L6'
      );
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
    tenantId: string,
  ): Promise<boolean> {
    const existingResult = await this.outboundGatewayRepository.fetchOutboundGatewayResult(
      tenantId,
      destSchemaName,
      outboundGatewayId
    );

    if (!existingResult) {
      throw new Error("Outbound gateway result not found for retry");
    }

    const connRows = await this.connectionRepository.getTenantConnectionMeta(
      targetConnectionId,
      tenantId
    );

    const targetAppName = connRows?.appName;
    const targetTenantId = connRows?.tenantId;

    const stitch = await this.stitchRepository.findById(tenantId, routeId);
    const targetObject = stitch?.targetObject ?? "";

    const resPayload = existingResult.response as Record<
      string,
      unknown
    > | null;
    const destVendorId = existingResult.destVendorId ?? undefined;

    return await this.deliveryService.writeL6Result(
      destSchemaName,
      srcSchemaName,
      outboundGatewayId,
      existingResult.attempts,
      dataSourceId,
      traceId,
      routeId,
      resPayload,
      null, // sentPayload is unknown during a source-finalization retry
      existingResult.statusCode ?? defaultStatusCode,
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
      tenantId,
    );
  }
}
