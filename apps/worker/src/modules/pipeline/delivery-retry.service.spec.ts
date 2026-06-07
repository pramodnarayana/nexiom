/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await */
import { Test, TestingModule } from "@nestjs/testing";
import { DeliveryRetryService } from "./delivery-retry.service.js";
import { DeliveryService } from "./delivery.service.js";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("DeliveryRetryService", () => {
  let service: DeliveryRetryService;
  let deliveryService: any;
  let db: any;

  beforeEach(async () => {
    deliveryService = {
      writeL6Result: vi.fn().mockResolvedValue(true),
    };

    db = {
      transaction: vi.fn().mockImplementation(async (cb) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        };
        return cb(tx);
      }),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryRetryService,
        { provide: DeliveryService, useValue: deliveryService },
      ],
    }).compile();

    service = module.get<DeliveryRetryService>(DeliveryRetryService);
  });

  describe("isSourceFinalized", () => {
    it("returns true if logs exist", async () => {
      db.transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ id: "1" }]),
        };
        return cb(tx);
      });

      const result = await service.isSourceFinalized("ws_1", "t1", "r1", db);
      expect(result).toBe(true);
    });

    it("returns false if logs do not exist", async () => {
      db.transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        };
        return cb(tx);
      });

      const result = await service.isSourceFinalized("ws_1", "t1", "r1", db);
      expect(result).toBe(false);
    });

    it("returns false and logs error on db failure", async () => {
      db.transaction.mockRejectedValueOnce(new Error("DB failed"));
      const result = await service.isSourceFinalized("ws_1", "t1", "r1", db);
      expect(result).toBe(false);
    });
  });

  describe("retrySourceFinalization", () => {
    it("should retry and invoke writeL6Result with correct destVendorId", async () => {
      db.transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([
            {
              response: { success: true },
              statusCode: 200,
              destVendorId: "vendor1",
              attempts: 2,
            },
          ]),
        };
        return cb(tx);
      });

      // connRows mock
      db.limit.mockResolvedValueOnce([
        { appName: "testApp", tenantId: "tenant1" },
      ]);
      // stitchDocs mock
      db.limit.mockResolvedValueOnce([{ targetObject: "obj" }]);

      const result = await service.retrySourceFinalization(
        "ws_dest",
        "ws_src",
        "gw_id",
        "trace_id",
        "route_id",
        "ds_id",
        "tgt_conn_id",
        "SUCCESS",
        500,
        "RAW",
        "srcApp",
        "srcTenant",
        "srcVendor",
        Date.now(),
        db,
      );

      expect(result).toBe(true);
      expect(deliveryService.writeL6Result).toHaveBeenCalledWith(
        "ws_dest",
        "ws_src",
        "gw_id",
        2,
        "ds_id",
        "trace_id",
        "route_id",
        { success: true },
        null,
        200,
        "SUCCESS",
        expect.any(Number),
        "vendor1",
        "RAW",
        "srcApp",
        "srcTenant",
        "srcVendor",
        "tgt_conn_id",
        "testApp",
        "tenant1",
        "obj",
        "tenant1",
        db,
      );
    });

    it("throws if existingResult is empty", async () => {
      db.transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        };
        return cb(tx);
      });

      await expect(
        service.retrySourceFinalization(
          "ws_dest",
          "ws_src",
          "gw_id",
          "trace_id",
          "route_id",
          "ds_id",
          "tgt_conn_id",
          "SUCCESS",
          500,
          "RAW",
          "srcApp",
          "srcTenant",
          "srcVendor",
          Date.now(),
          db,
        ),
      ).rejects.toThrow("Outbound gateway result not found for retry");
    });

    it("should handle nullish or missing fields gracefully", async () => {
      db.transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([
            {
              response: null,
              statusCode: null,
              destVendorId: null,
              attempts: 3,
            },
          ]),
        };
        return cb(tx);
      });

      // connRows mock: empty array
      db.limit.mockResolvedValueOnce([]);
      // stitchDocs mock: empty array
      db.limit.mockResolvedValueOnce([]);

      const result = await service.retrySourceFinalization(
        "ws_dest",
        "ws_src",
        "gw_id",
        "trace_id",
        "route_id",
        "ds_id",
        "tgt_conn_id",
        "SUCCESS",
        500, // default status code
        "RAW",
        "srcApp",
        "srcTenant",
        "srcVendor",
        Date.now(),
        db,
      );

      expect(result).toBe(true);
      expect(deliveryService.writeL6Result).toHaveBeenCalledWith(
        "ws_dest",
        "ws_src",
        "gw_id",
        3,
        "ds_id",
        "trace_id",
        "route_id",
        null, // resPayload
        null, // sentPayload
        500, // statusCode coalesced to default
        "SUCCESS",
        expect.any(Number),
        undefined, // destVendorId coalesced
        "RAW",
        "srcApp",
        "srcTenant",
        "srcVendor",
        "tgt_conn_id",
        undefined, // targetAppName
        undefined, // targetTenantId
        "", // targetObject coalesced
        undefined, // targetTenantId (again)
        db,
      );
    });
  });
});
