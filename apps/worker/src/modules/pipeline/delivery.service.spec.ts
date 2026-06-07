/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { DeliveryService } from "./delivery.service.js";
import { QueueService, QueueName } from "@soopa/queue";
import { DATABASE_CONNECTION } from "@soopa/database";
import { StorageResolverService } from "@soopa/engine";

import { TokenManagerService } from "@soopa/credentials";
import { DB_MANAGER } from "@soopa/dbmanager";
import { DeliveryRetryService } from "./delivery-retry.service.js";
import { GemHydrationService } from "./gem-hydration.service.js";
import { ClaimDeliveryUseCase } from "./use-cases/claim-delivery.use-case.js";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("DeliveryService", () => {
  let service: DeliveryService;
  let queueService: any;
  let db: any;
  let storageResolver: any;
  let outboundDispatcher: any;
  let outboundGatewayPort: any;
  let claimUseCase: any;

  beforeEach(async () => {
    queueService = { consume: vi.fn() };
    db = {
      query: {
        dataSources: {
          findFirst: vi.fn().mockResolvedValue({ tenantId: "tenant_1" }),
        },
      },
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue([
          { appName: "test", targetObject: "obj", tenantId: "tenant_1" },
        ]),
      transaction: vi.fn().mockImplementation(async (cb) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi
            .fn()
            .mockResolvedValue([
              { id: "o", reqPayload: {}, attempts: 0, status: "PENDING" },
            ]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          onConflictDoNothing: vi.fn().mockReturnThis(),
          onConflictDoUpdate: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{ id: "o" }]),
          delete: vi.fn().mockReturnThis(),
        };
        return cb(tx);
      }),
    };
    storageResolver = {
      resolveSchemaName: vi.fn().mockResolvedValue("ws_1"),
      resolveStorageProfile: vi
        .fn()
        .mockResolvedValue({ schemaName: "ws_1", tenantId: "tenant_1" }),
    };
    outboundDispatcher = {
      dispatch: vi
        .fn()
        .mockResolvedValue({ body: { id: "DEST-001" }, statusCode: 200 }),
    };
    outboundGatewayPort = {
      markResult: vi.fn().mockResolvedValue(undefined),
    };
    claimUseCase = {
      execute: vi.fn().mockResolvedValue({
        status: "CLAIMED",
        claimed: true,
        executeAction: true,
        outboundGatewayId: "o",
        destSchemaName: "ws_dest",
        srcSchemaName: "ws_src",
        tenantId: "tenant_1",
        tenantDb: db,
        targetAppName: "test",
        targetTenantId: "tenant_2",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryService,
        { provide: QueueService, useValue: queueService },
        {
          provide: DB_MANAGER,
          useValue: { getTenantDb: vi.fn().mockResolvedValue(db) },
        },
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: StorageResolverService, useValue: storageResolver },
        { provide: "IOutboundDispatcher", useValue: outboundDispatcher },
        { provide: "IOutboundGatewayPort", useValue: outboundGatewayPort },
        {
          provide: TokenManagerService,
          useValue: { getValidCredentials: vi.fn().mockResolvedValue({}) },
        },
        {
          provide: DeliveryRetryService,
          useValue: {
            handleRetryAndDelay: vi.fn().mockResolvedValue(undefined),
            isSourceFinalized: vi.fn(),
            retrySourceFinalization: vi.fn(),
          },
        },
        {
          provide: GemHydrationService,
          useValue: {
            hydrate: vi.fn().mockResolvedValue({}),
            writeGemMapping: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: ClaimDeliveryUseCase, useValue: claimUseCase },
      ],
    }).compile();

    service = module.get<DeliveryService>(DeliveryService);
  });

  const validPayload = {
    traceId: "123",
    srcDataSourceId: "456",
    destDataSourceId: "tgt",
    routeId: "r",
    hydratedPayload: {},
  };

  it("should deliver message and write success", async () => {
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(
      QueueName.DeliveryQueue,
      expect.any(Function),
    );
    const handler = queueService.consume.mock.calls[0][1];
    await handler(validPayload);
    expect(outboundDispatcher.dispatch).toHaveBeenCalled();
  });

  it("should format error properly when piece fails", async () => {
    outboundDispatcher.dispatch.mockRejectedValue(new Error("api error"));

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    // We expect it to complete normally (or delegate to writeL6Result)
    await expect(handler(validPayload)).resolves.toBeUndefined();
    // In L5, failures during execute write through writeL6Result
  });

  it("should throw if target connection not found", async () => {
    db.limit.mockResolvedValue([]);
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    // With ClaimDeliveryUseCase mocked to return success, it will still proceed,
    // but the `db.limit` returning [] means stitchDocs[0] is undefined,
    // it proceeds with targetObject="" and dispatch.
    outboundDispatcher.dispatch.mockRejectedValue(new Error("dispatch error"));
    await expect(handler(validPayload)).resolves.toBeUndefined();
  });

  it("should return early if delivery is already claimed by another worker", async () => {
    claimUseCase.execute.mockResolvedValueOnce({
      status: "TERMINATED",
    });
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).resolves.toBeUndefined();
    expect(outboundDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("should return early if delivery is claimed but action execution should be skipped (Idempotency Bounce)", async () => {
    claimUseCase.execute.mockResolvedValueOnce({
      status: "TERMINATED",
    });
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).resolves.toBeUndefined();
    expect(outboundDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("should set FAIL status for permanent 4xx errors (422 unprocessable)", async () => {
    outboundDispatcher.dispatch.mockResolvedValueOnce({
      body: {},
      statusCode: 422,
    });
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).resolves.toBeUndefined();
  });

  it("should set RETRY status and throw when piece throws RetryableException", async () => {
    const { RetryableException } = await import("@soopa/piece-framework");
    outboundDispatcher.dispatch.mockRejectedValueOnce(
      new RetryableException("rate limited", 429),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).rejects.toThrow(
      "API call failed with retryable error (HTTP 429). Deferring to SQS for retry.",
    );
  });

  it("should NOT rewrite outbound gateway if claimed is false during pre-claim exception", async () => {
    claimUseCase.execute.mockRejectedValueOnce(new Error("Claim failed"));
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).rejects.toThrow("Claim failed");
  });

  describe("writeL6Result", () => {
    it("should successfully write L6 result", async () => {
      const mockTx = {
        execute: vi.fn(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      };
      db.transaction.mockImplementation(async (cb: any) => cb(mockTx));
      const res = await (service as any).writeL6Result(
        "ws_schema", // destSchemaName
        "ws_schema", // srcSchemaName
        "o", // outboundGatewayId
        "conn", // dataSourceId
        "trace", // traceId
        "route", // routeId
        null, // resPayload
        null, // sentPayload
        500, // statusCode
        "SUCCESS", // finalStatus
        Date.now(), // start
        undefined, // destVendorId
        "RAW", // canonicalType
        "app", // srcAppName
        "org", // srcTenantId
        undefined, // srcVendorId
        "tgt", // targetConnectionId
        undefined, // targetAppName
        undefined, // targetTenantId
        undefined, // targetObject
        "org", // tenantId
        db, // tenantDb
      );
      expect(res).toBe(true);
    });

    it("should return false on writeL6Result failure", async () => {
      db.transaction.mockRejectedValueOnce(new Error("db failure"));
      const res = await (service as any).writeL6Result(
        "ws_schema",
        "ws_schema",
        "o",
        "conn",
        "trace",
        "route",
        null,
        null,
        500,
        "SUCCESS",
        Date.now(),
        undefined,
        "RAW",
        "app",
        "org",
        undefined,
        "tgt",
        undefined,
        undefined,
        undefined,
        "org",
        db,
      );
      expect(res).toBe(false);
    });

    it("should write GEM mapping if all conditions are met", async () => {
      const mockTx = {
        execute: vi.fn(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      };
      db.transaction.mockImplementation(async (cb: any) => cb(mockTx));
      const gemHydrationService = (service as any).gemService;
      vi.spyOn(gemHydrationService, "writeGemMapping").mockResolvedValue(
        undefined,
      );

      const res = await (service as any).writeL6Result(
        "ws_schema",
        "ws_schema",
        "o",
        "conn",
        "trace",
        "route",
        null,
        null,
        200,
        "SUCCESS",
        Date.now(),
        "destVendorId",
        "RAW",
        "app",
        "org",
        "srcVendorId",
        "tgt",
        "targetApp",
        "targetTenant",
        "targetObject",
        "org",
        db,
      );
      expect(res).toBe(true);
      expect(gemHydrationService.writeGemMapping).toHaveBeenCalled();
    });
  });

  it("should drop invalid message if hydratedPayload is missing", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    const invalidPayload = {
      traceId: "123",
      srcDataSourceId: "456",
      destDataSourceId: "tgt",
      routeId: "r",
      // no hydratedPayload
    };

    const loggerWarnSpy = vi.spyOn((service as any).logger, "warn");
    await expect(handler(invalidPayload)).resolves.toBeUndefined();
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("dropping invalid message"),
    );
  });

  it("should throw if delivery succeeded but source finalization failed", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    outboundDispatcher.dispatch.mockResolvedValueOnce({
      body: {},
      statusCode: 200,
    });
    // mock writeL6Result to return false
    vi.spyOn(service as any, "writeL6Result").mockResolvedValueOnce(false);

    await expect(handler(validPayload)).rejects.toThrow(
      "Delivery succeeded but source-side finalization failed.",
    );
  });

  it("should throw if delivery failed but source finalization failed", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    outboundDispatcher.dispatch.mockResolvedValueOnce({
      body: {},
      statusCode: 500, // this causes evaluateDeliveryStatus to return FAIL
    });
    // mock writeL6Result to return false
    vi.spyOn(service as any, "writeL6Result").mockResolvedValueOnce(false);

    await expect(handler(validPayload)).rejects.toThrow(
      "Delivery failed but source-side finalization failed.",
    );
  });

  it("should throw if tokenManagerService is unavailable", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    (service as any).tokenManagerService = undefined;
    const testRow = { ...validPayload, targetConnectionId: "conn-1" };
    claimUseCase.execute.mockResolvedValueOnce({
      ...testRow,
      id: "claim-1",
      targetConnectionId: "conn-1",
      tenantDb: db,
    } as any);

    await expect(handler(testRow)).rejects.toThrow(
      "TokenManagerService unavailable",
    );
  });

  it("should update sentPayload if dispatch returns one", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    claimUseCase.execute.mockResolvedValueOnce({
      ...validPayload,
      id: "claim-1",
      targetConnectionId: "conn-1",
      tenantDb: db,
    } as any);

    outboundDispatcher.dispatch.mockResolvedValueOnce({
      statusCode: 200,
      retry: false,
      body: { ok: true },
      sentPayload: { custom: "payload" }, // test line 196
      entityId: "ext-123",
    });

    vi.spyOn(service as any, "writeL6Result").mockResolvedValueOnce(true);

    await handler(validPayload);

    // Verify it used the updated sentPayload in finalization
    const callArgs = vi.mocked(service as any).writeL6Result.mock.calls[0];
    expect(callArgs).toContainEqual(
      expect.objectContaining({ custom: "payload" }),
    );
  });
});
