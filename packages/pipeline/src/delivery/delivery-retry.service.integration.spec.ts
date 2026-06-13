import "reflect-metadata";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeliveryRetryService } from "./delivery-retry.service.js";

describe("DeliveryRetryService", () => {
  let service: DeliveryRetryService;
  let deliveryService: any;
  let moduleRef: any;
  let syncLogRepository: any;
  let connectionRepository: any;
  let stitchRepository: any;
  let outboundGatewayRepository: any;

  beforeEach(() => {
    deliveryService = {
      writeL6Result: vi.fn().mockResolvedValue(true),
    };

    moduleRef = {
      get: vi.fn().mockReturnValue(deliveryService),
    };

    syncLogRepository = {
      hasCompletedSyncLog: vi.fn().mockResolvedValue(true),
    };

    connectionRepository = {
      getTenantConnectionMeta: vi.fn().mockResolvedValue({ appName: "App", tenantId: "tenant1" }),
    };

    stitchRepository = {
      findById: vi.fn().mockResolvedValue({ targetObject: "Contact" }),
    };

    outboundGatewayRepository = {
      fetchOutboundGatewayResult: vi.fn().mockResolvedValue({
        response: { id: "res1" },
        destVendorId: "vend1",
        attempts: 1,
        statusCode: 200,
      }),
    };

    service = new DeliveryRetryService(
      moduleRef,
      syncLogRepository,
      connectionRepository,
      stitchRepository,
      outboundGatewayRepository,
      {} as any
    );
  });

  describe("isSourceFinalized", () => {
    it("returns true if logs exist", async () => {
      const result = await service.isSourceFinalized("tenant1", "srcSchema", "trace1", "route1");
      expect(syncLogRepository.hasCompletedSyncLog).toHaveBeenCalledWith(
        "tenant1",
        "srcSchema",
        "trace1",
        "route1",
        "L6"
      );
      expect(result).toBe(true);
    });

    it("returns false if logs do not exist", async () => {
      syncLogRepository.hasCompletedSyncLog.mockResolvedValue(false);
      const result = await service.isSourceFinalized("tenant1", "srcSchema", "trace1", "route1");
      expect(result).toBe(false);
    });

    it("returns false and logs error on db failure", async () => {
      syncLogRepository.hasCompletedSyncLog.mockRejectedValue(new Error("DB failed"));
      const result = await service.isSourceFinalized("tenant1", "srcSchema", "trace1", "route1");
      expect(result).toBe(false);
    });
  });

  describe("retrySourceFinalization", () => {
    it("should retry and invoke writeL6Result with correct destVendorId", async () => {
      const result = await service.retrySourceFinalization(
        "destSchema",
        "srcSchema",
        "gwId",
        "trace1",
        "route1",
        "dsId",
        "tgtConn",
        "SUCCESS",
        200,
        "Contact",
        "srcApp",
        "srcTenant",
        "srcVendor",
        12345,
        "tenant1"
      );

      expect(outboundGatewayRepository.fetchOutboundGatewayResult).toHaveBeenCalledWith(
        "tenant1",
        "destSchema",
        "gwId"
      );

      expect(connectionRepository.getTenantConnectionMeta).toHaveBeenCalledWith(
        "tgtConn",
        "tenant1"
      );

      expect(stitchRepository.findById).toHaveBeenCalledWith(
        "tenant1",
        "route1"
      );

      expect(deliveryService.writeL6Result).toHaveBeenCalledWith(
        "destSchema",
        "srcSchema",
        "gwId",
        1, // attempts
        "dsId",
        "trace1",
        "route1",
        { id: "res1" }, // resPayload
        null, // sentPayload
        200, // statusCode
        "SUCCESS", // finalStatus
        12345, // start
        "vend1", // destVendorId
        "Contact", // canonicalType
        "srcApp",
        "srcTenant",
        "srcVendor",
        "tgtConn",
        "App", // targetAppName
        "tenant1", // targetTenantId
        "Contact", // targetObject
        "tenant1" // tenantId
      );

      expect(result).toBe(true);
    });

    it("should throw if existing outbound gateway result not found", async () => {
      outboundGatewayRepository.fetchOutboundGatewayResult.mockResolvedValue(null);

      await expect(
        service.retrySourceFinalization(
          "destSchema",
          "srcSchema",
          "gwId",
          "trace1",
          "route1",
          "dsId",
          "tgtConn",
          "SUCCESS",
          200,
          "Contact",
          "srcApp",
          "srcTenant",
          "srcVendor",
          12345,
          "tenant1"
        )
      ).rejects.toThrow("Outbound gateway result not found for retry");
    });
  });
});
