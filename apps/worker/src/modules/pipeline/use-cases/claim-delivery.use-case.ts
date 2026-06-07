import { Injectable, Inject, Logger, forwardRef } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE_CONNECTION, dataSources } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import { StorageResolverService } from "@soopa/engine";
import { DB_MANAGER } from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";
import type { IOutboundGatewayPort } from "@soopa/domain-core";
import { DeliveryRetryService } from "../delivery-retry.service.js";
import { sanitizeErrorObject } from "../../../shared/pipeline.utils.js";
import { MAX_DELIVERY_ATTEMPTS } from "../delivery.service.js";

export interface ClaimDeliveryInput {
  traceId: string;
  dataSourceId: string;
  targetConnectionId: string;
  routeId: string;
  hydratedPayload: Record<string, unknown>;
  srcVendorId?: string;
  canonicalType: string;
  srcAppName: string;
  srcTenantId: string;
  start: number;
  writeL6ResultFn: (
    destSchemaName: string,
    srcSchemaName: string,
    outboundGatewayId: string,
    dataSourceId: string,
    traceId: string,
    routeId: string,
    resPayload: Record<string, unknown> | null,
    sentPayload: Record<string, unknown> | null,
    statusCode: number,
    finalStatus: "SUCCESS" | "FAIL" | "RETRY",
    start: number,
    destVendorId: string | undefined,
    canonicalType: string,
    srcAppName: string,
    srcTenantId: string,
    srcVendorId: string | undefined,
    targetConnectionId: string,
    targetAppName: string | undefined,
    targetTenantId: string | undefined,
    targetObject: string | undefined,
    tenantId: string,
    tenantDb: DrizzleDb,
  ) => Promise<boolean>;
}

export type ClaimDeliveryResult =
  | {
      status: "CLAIMED";
      destSchemaName: string;
      srcSchemaName: string;
      outboundGatewayId: string;
      tenantId: string;
      tenantDb: DrizzleDb;
      targetAppName: string;
      targetTenantId: string;
    }
  | { status: "TERMINATED" }; // For MAX_ATTEMPTS or Duplicates

@Injectable()
export class ClaimDeliveryUseCase {
  private readonly logger = new Logger(ClaimDeliveryUseCase.name);

  constructor(
    private readonly storageResolver: StorageResolverService,
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    @Inject("IOutboundGatewayPort")
    private readonly outboundGatewayPort: IOutboundGatewayPort,
    @Inject(forwardRef(() => DeliveryRetryService))
    private readonly retryService: DeliveryRetryService,
  ) {}

  async execute(input: ClaimDeliveryInput): Promise<ClaimDeliveryResult> {
    const {
      traceId,
      dataSourceId,
      targetConnectionId,
      routeId,
      hydratedPayload,
      srcVendorId,
      canonicalType,
      srcAppName,
      srcTenantId,
      start,
      writeL6ResultFn,
    } = input;

    const destSchemaName =
      await this.storageResolver.resolveSchemaName(targetConnectionId);
    const srcSchemaName =
      await this.storageResolver.resolveSchemaName(dataSourceId);

    const connectionMeta = await this.globalDb
      .select({ tenantId: dataSources.tenantId })
      .from(dataSources)
      .where(eq(dataSources.id, targetConnectionId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!connectionMeta) {
      throw new Error(
        `Connection ${targetConnectionId} not found in global DB`,
      );
    }

    const tenantId = connectionMeta.tenantId;
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    // ── TX-1: Insert PENDING or fetch existing outbound_gateway ─
    const gatewayRes = await this.outboundGatewayPort.insertOrFetchPending(
      tenantId,
      destSchemaName,
      {
        traceId,
        routeId,
        dataSourceId: targetConnectionId,
        srcDataSourceId: dataSourceId,
        payload: hydratedPayload,
      },
    );

    const outboundGatewayId = gatewayRes.id;
    const currentAttemptCount = gatewayRes.attempts;
    const currentStatus = gatewayRes.status;

    // ── MAX_ATTEMPTS guard ────────────────────────────────────────────────
    if (currentAttemptCount >= MAX_DELIVERY_ATTEMPTS) {
      this.logger.error(
        {
          event: "l5.max_attempts",
          outboundGatewayId,
          traceId,
          routeId,
          layer: "L5",
          attemptCount: currentAttemptCount,
        },
        "Max delivery attempts exceeded — permanently failing",
      );
      await writeL6ResultFn(
        destSchemaName,
        srcSchemaName,
        outboundGatewayId,
        dataSourceId,
        traceId,
        routeId,
        null,
        null,
        500,
        "FAIL",
        start,
        undefined,
        canonicalType,
        srcAppName,
        srcTenantId,
        srcVendorId,
        targetConnectionId,
        undefined,
        undefined,
        undefined,
        tenantId,
        tenantDb,
      );
      return { status: "TERMINATED" };
    }

    let sourceFinalized = false;

    // ── Check if delivery already succeeded AND source-side finalized ─────
    if (currentStatus === "SUCCESS") {
      sourceFinalized = await this.retryService.isSourceFinalized(
        srcSchemaName,
        traceId,
        routeId,
        tenantDb,
      );
      if (sourceFinalized) {
        this.logger.debug(
          { event: "l5.skip_success", traceId, routeId, layer: "L5" },
          "Delivery already succeeded and source finalized, skipping duplicate processing",
        );
        return { status: "TERMINATED" };
      } else {
        this.logger.warn(
          {
            event: "l5.partial_success",
            traceId,
            routeId,
            layer: "L5",
          },
          "Delivery succeeded but source-side incomplete — retrying finalization only",
        );

        sourceFinalized = await this.retryService.retrySourceFinalization(
          destSchemaName,
          srcSchemaName,
          outboundGatewayId,
          traceId,
          routeId,
          dataSourceId,
          targetConnectionId,
          "SUCCESS",
          200,
          canonicalType,
          srcAppName,
          srcTenantId,
          srcVendorId,
          start,
          tenantDb,
        );

        if (!sourceFinalized) {
          throw new Error(
            "Source-side finalization retry failed. Deferring to SQS for retry.",
          );
        }

        this.logger.log(
          {
            event: "l6.finalization_retry_success",
            traceId,
            routeId,
            layer: "L6",
          },
          "Source-side finalization retry succeeded",
        );
        return { status: "TERMINATED" };
      }
    }

    // ── Check if delivery already failed AND source-side finalized ─────
    if (currentStatus === "FAIL") {
      sourceFinalized = await this.retryService.isSourceFinalized(
        srcSchemaName,
        traceId,
        routeId,
        tenantDb,
      );
      if (sourceFinalized) {
        this.logger.debug(
          { event: "l5.skip_fail", traceId, routeId, layer: "L5" },
          "Delivery already failed and source finalized, skipping duplicate processing",
        );
        return { status: "TERMINATED" };
      } else {
        this.logger.error(
          {
            event: "l5.delivery_error",
            traceId,
            routeId,
            err: sanitizeErrorObject(
              new Error("Delivery failed but source-side incomplete"),
            ),
          },
          "L5 routing delivery failed: Delivery failed but source-side incomplete",
        );

        sourceFinalized = await this.retryService.retrySourceFinalization(
          destSchemaName,
          srcSchemaName,
          outboundGatewayId,
          traceId,
          routeId,
          dataSourceId,
          targetConnectionId,
          "FAIL",
          500,
          canonicalType,
          srcAppName,
          srcTenantId,
          srcVendorId,
          start,
          tenantDb,
        );

        if (!sourceFinalized) {
          throw new Error(
            "Source-side finalization retry failed. Deferring to SQS for retry.",
          );
        }

        this.logger.log(
          {
            event: "l6.finalization_retry_success",
            traceId,
            routeId,
            layer: "L6",
          },
          "Source-side finalization retry succeeded",
        );
        return { status: "TERMINATED" };
      }
    }

    // ── Resolve target piece using typed dataSources query ─────────────
    const connRows = await tenantDb
      .select({
        appName: dataSources.appName,
        tenantId: dataSources.tenantId,
      })
      .from(dataSources)
      .where(eq(dataSources.id, targetConnectionId))
      .limit(1);

    if (!connRows.length) {
      throw new Error(`Target connection ${targetConnectionId} not found`);
    }

    const targetAppName = connRows[0].appName;
    const targetTenantId = connRows[0].tenantId;

    // ── TX-2: Atomic claim — transition PENDING/RETRY → PROCESSING ────────
    const claimed = await this.outboundGatewayPort.claimForProcessing(
      tenantId,
      destSchemaName,
      outboundGatewayId,
    );

    if (!claimed) {
      this.logger.warn(
        {
          event: "l5.claim_failed",
          outboundGatewayId,
          traceId,
          layer: "L5",
        },
        "Delivery already claimed or completed by another worker",
      );
      return { status: "TERMINATED" };
    }

    return {
      status: "CLAIMED",
      destSchemaName,
      srcSchemaName,
      outboundGatewayId,
      tenantId,
      tenantDb,
      targetAppName,
      targetTenantId,
    };
  }
}
