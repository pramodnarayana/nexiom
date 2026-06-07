/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from "@nestjs/testing";
import {
  GemHydrationService,
  GemMappingParams,
} from "./gem-hydration.service.js";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("GemHydrationService", () => {
  let service: GemHydrationService;
  let tenantDb: any;

  beforeEach(async () => {
    tenantDb = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [GemHydrationService],
    }).compile();

    service = module.get<GemHydrationService>(GemHydrationService);
  });

  it("should write gem mapping successfully", async () => {
    const params: GemMappingParams = {
      traceId: "t1",
      routeId: "r1",
      srcAppName: "Salesforce",
      dataSourceId: "ds1",
      srcTenantId: "ten1",
      canonicalType: "Contact",
      srcVendorId: "v1",
      targetAppName: "Hubspot",
      targetConnectionId: "tc1",
      targetTenantId: "ten2",
      destVendorId: "dv1",
    };

    await service.writeGemMapping(tenantDb, params);

    expect(tenantDb.insert).toHaveBeenCalled();
    expect(tenantDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        stitchId: "r1",
        sourceAppName: "Salesforce",
        sourceDataSourceId: "ds1",
        sourceOrgId: "ten1",
        sourceEntityType: "Contact",
        sourceEntityId: "v1",
        destAppName: "Hubspot",
        destEntityId: "dv1",
      }),
    );
    expect(tenantDb.onConflictDoUpdate).toHaveBeenCalled();
  });
});
