/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from "@nestjs/testing";
import { ClaimDeliveryUseCase } from "./claim-delivery.use-case.js";
import { StorageResolverService } from "@soopa/engine";
import { DATABASE_CONNECTION } from "@soopa/database";
import { DB_MANAGER } from "@soopa/dbmanager";
import { DeliveryRetryService } from "../delivery-retry.service.js";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_DELIVERY_ATTEMPTS } from "../delivery.service.js";

describe("ClaimDeliveryUseCase", () => {
  let useCase: ClaimDeliveryUseCase;
  let storageResolver: any;
  let globalDb: any;
  let dbManager: any;
  let outboundGatewayPort: any;
  let retryService: any;
  let tenantDb: any;

  const mockInput: any = {
    traceId: "t1",
    dataSourceId: "ds1",
    targetConnectionId: "tc1",
    routeId: "r1",
    hydratedPayload: { data: 1 },
    canonicalType: "Contact",
    srcAppName: "App",
    srcTenantId: "ten1",
    start: Date.now(),
    writeL6ResultFn: vi.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    storageResolver = {
      resolveSchemaName: vi.fn().mockResolvedValue("ws_schema"),
    };

    tenantDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ appName: "App2", tenantId: "ten1" }]),
    };

    globalDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ tenantId: "ten1" }]),
    };

    dbManager = {
      getTenantDb: vi.fn().mockResolvedValue(tenantDb),
    };

    outboundGatewayPort = {
      insertOrFetchPending: vi.fn().mockResolvedValue({
        id: "gw1",
        attempts: 1,
        status: "PENDING",
      }),
      claimForProcessing: vi
        .fn()
        .mockResolvedValue({ claimed: true, attemptCount: 1 }),
    };

    retryService = {
      isSourceFinalized: vi.fn().mockResolvedValue(true),
      retrySourceFinalization: vi.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimDeliveryUseCase,
        { provide: StorageResolverService, useValue: storageResolver },
        { provide: DATABASE_CONNECTION, useValue: globalDb },
        { provide: DB_MANAGER, useValue: dbManager },
        { provide: "IOutboundGatewayPort", useValue: outboundGatewayPort },
        { provide: DeliveryRetryService, useValue: retryService },
      ],
    }).compile();

    useCase = module.get<ClaimDeliveryUseCase>(ClaimDeliveryUseCase);
  });

  it("should successfully claim delivery", async () => {
    const result = await useCase.execute(mockInput);
    expect(result.status).toBe("CLAIMED");
    if (result.status === "CLAIMED") {
      expect(result.outboundGatewayId).toBe("gw1");
      expect(result.targetAppName).toBe("App2");
    }
  });

  it("should throw if globalDb connection meta is not found", async () => {
    globalDb.limit.mockResolvedValueOnce([]);
    await expect(useCase.execute(mockInput)).rejects.toThrow(
      "Connection tc1 not found",
    );
  });

  it("should terminate and fail on max attempts", async () => {
    outboundGatewayPort.insertOrFetchPending.mockResolvedValueOnce({
      id: "gw1",
      attempts: MAX_DELIVERY_ATTEMPTS,
      status: "PENDING",
    });

    const result = await useCase.execute(mockInput);
    expect(result.status).toBe("TERMINATED");
    expect(mockInput.writeL6ResultFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "gw1",
      MAX_DELIVERY_ATTEMPTS,
      "ds1",
      "t1",
      "r1",
      null,
      null,
      500,
      "FAIL",
      expect.anything(),
      undefined,
      "Contact",
      "App",
      "ten1",
      undefined,
      "tc1",
      undefined,
      undefined,
      undefined,
      "ten1",
      tenantDb,
    );
  });

  it("should terminate if already SUCCESS and source finalized", async () => {
    outboundGatewayPort.insertOrFetchPending.mockResolvedValueOnce({
      id: "gw1",
      attempts: 1,
      status: "SUCCESS",
    });
    retryService.isSourceFinalized.mockResolvedValueOnce(true);

    const result = await useCase.execute(mockInput);
    expect(result.status).toBe("TERMINATED");
    expect(retryService.retrySourceFinalization).not.toHaveBeenCalled();
  });

  it("should retry finalization if SUCCESS but source NOT finalized", async () => {
    outboundGatewayPort.insertOrFetchPending.mockResolvedValueOnce({
      id: "gw1",
      attempts: 1,
      status: "SUCCESS",
    });
    retryService.isSourceFinalized.mockResolvedValueOnce(false);
    retryService.retrySourceFinalization.mockResolvedValueOnce(true);

    const result = await useCase.execute(mockInput);
    expect(result.status).toBe("TERMINATED");
    expect(retryService.retrySourceFinalization).toHaveBeenCalled();
  });

  it("should throw if SUCCESS and source finalization retry fails", async () => {
    outboundGatewayPort.insertOrFetchPending.mockResolvedValueOnce({
      id: "gw1",
      attempts: 1,
      status: "SUCCESS",
    });
    retryService.isSourceFinalized.mockResolvedValueOnce(false);
    retryService.retrySourceFinalization.mockResolvedValueOnce(false); // fails

    await expect(useCase.execute(mockInput)).rejects.toThrow(
      "Source-side finalization retry failed",
    );
  });

  it("should terminate if already FAIL and source finalized", async () => {
    outboundGatewayPort.insertOrFetchPending.mockResolvedValueOnce({
      id: "gw1",
      attempts: 1,
      status: "FAIL",
    });
    retryService.isSourceFinalized.mockResolvedValueOnce(true);

    const result = await useCase.execute(mockInput);
    expect(result.status).toBe("TERMINATED");
  });

  it("should retry finalization if FAIL but source NOT finalized", async () => {
    outboundGatewayPort.insertOrFetchPending.mockResolvedValueOnce({
      id: "gw1",
      attempts: 1,
      status: "FAIL",
    });
    retryService.isSourceFinalized.mockResolvedValueOnce(false);
    retryService.retrySourceFinalization.mockResolvedValueOnce(true);

    const result = await useCase.execute(mockInput);
    expect(result.status).toBe("TERMINATED");
    expect(retryService.retrySourceFinalization).toHaveBeenCalled();
  });

  it("should throw if FAIL and source finalization retry fails", async () => {
    outboundGatewayPort.insertOrFetchPending.mockResolvedValueOnce({
      id: "gw1",
      attempts: 1,
      status: "FAIL",
    });
    retryService.isSourceFinalized.mockResolvedValueOnce(false);
    retryService.retrySourceFinalization.mockResolvedValueOnce(false); // fails

    await expect(useCase.execute(mockInput)).rejects.toThrow(
      "Source-side finalization retry failed",
    );
  });

  it("should throw if tenant target connection not found", async () => {
    tenantDb.limit.mockResolvedValueOnce([]); // no target connection
    await expect(useCase.execute(mockInput)).rejects.toThrow(
      "Target connection tc1 not found",
    );
  });

  it("should terminate if claiming fails", async () => {
    outboundGatewayPort.claimForProcessing.mockResolvedValueOnce({
      claimed: false,
      attemptCount: 0,
    });
    const result = await useCase.execute(mockInput);
    expect(result.status).toBe("TERMINATED");
  });
});
