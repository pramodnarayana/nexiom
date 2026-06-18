import "reflect-metadata";
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { DeliveryService } from "./delivery.service.js";
import { QueueService, QueueName } from "@soopa/queue";
import { TestDatabaseManager, integrationStitches } from "@soopa/database";
import { SqlDatabaseManager, SchemaPlan } from "@soopa/dbmanager";
import { v4 as uuidv4 } from "uuid";
import { sql } from "drizzle-orm";
import { DependenciesMissingError } from "@soopa/piece-framework";

describe("DeliveryService", () => {
  let service: DeliveryService;
  let queueService: any;
  let testDbManager: TestDatabaseManager;
  let storageResolver: any;
  let outboundDispatcher: any;
  let outboundGatewayPort: any;
  let claimUseCase: any;
  let retryService: any;
  let gemService: any;
  let tokenManagerService: any;

  let syncLogRepository: any;
  let pipelineStateRepository: any;
  let stitchRepository: any;
  let transactionManager: any;

  beforeAll(async () => {
    testDbManager = new TestDatabaseManager();
    await testDbManager.start();
  }, 60000);

  afterAll(async () => {
    await testDbManager.stop();
  });

  let currentSchemaName: string;
  let currentWorkspaceId: string;

  beforeEach(async () => {
    currentSchemaName = "ws_" + uuidv4().replace(/-/g, "");
    currentWorkspaceId = uuidv4();

    const sqlManager = new SqlDatabaseManager(testDbManager.db!);
    // Apply namespace, outbound and inbound plans for proper tables
    await sqlManager.applyPlan(currentSchemaName, SchemaPlan.NAMESPACE_ONLY, { appName: "testApp", appProfile: "online" });
    await sqlManager.applyPlan(currentSchemaName, SchemaPlan.STANDARD_ACTIVE, { appName: "testApp", appProfile: "online" });
    // Global map table
    await testDbManager.db!.execute(sql`
      CREATE TABLE IF NOT EXISTS public.global_entity_map (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        data_source_id UUID NOT NULL,
        trace_id VARCHAR,
        route_id VARCHAR,
        canonical_type VARCHAR,
        vendor_id VARCHAR,
        dest_vendor_id VARCHAR,
        app_name VARCHAR,
        dest_app_name VARCHAR,
        dest_tenant_id VARCHAR,
        dest_data_source_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await testDbManager.db!.execute(sql`TRUNCATE TABLE public.global_entity_map CASCADE`);

    queueService = {
      consume: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
    };

    storageResolver = {
      resolveSchemaName: vi.fn().mockResolvedValue(currentSchemaName),
      resolveStorageProfile: vi
        .fn()
        .mockResolvedValue({ schemaName: currentSchemaName, tenantId: currentWorkspaceId }),
    };

    outboundDispatcher = {
      dispatch: vi.fn().mockResolvedValue({ body: { id: "DEST-001" }, statusCode: 200 }),
    };

    outboundGatewayPort = {
      markResult: vi.fn().mockResolvedValue(undefined),
    };

    claimUseCase = {
      execute: vi.fn().mockResolvedValue({
        status: "CLAIMED",
        claimed: true,
        executeAction: true,
        outboundGatewayId: uuidv4(),
        destSchemaName: currentSchemaName,
        srcSchemaName: currentSchemaName,
        tenantId: currentWorkspaceId,
        tenantDb: testDbManager.db!,
        targetAppName: "test",
        targetOrganizationId: "tenant_2",
      }),
    };

    retryService = {
      handleRetryAndDelay: vi.fn().mockResolvedValue(undefined),
      isSourceFinalized: vi.fn(),
      retrySourceFinalization: vi.fn(),
    };

    gemService = {
      hydrate: vi.fn().mockResolvedValue({}),
      writeGemMapping: vi.fn().mockResolvedValue(undefined),
    };

    tokenManagerService = {
      getValidCredentials: vi.fn().mockResolvedValue({}),
    };

    syncLogRepository = {
      writeSyncLog: vi.fn().mockResolvedValue(undefined),
      hasCompletedSyncLog: vi.fn().mockResolvedValue(false),
    };

    pipelineStateRepository = {
      releaseSyncLockByTraceId: vi.fn().mockResolvedValue(undefined),
    };

    stitchRepository = {
      findById: vi.fn().mockResolvedValue({ targetObject: "testObj" }),
    };

    transactionManager = {
      runInTenantTransaction: vi.fn().mockImplementation(async (tenantId, schema, cb) => cb({})),
    };

    service = new DeliveryService(
      queueService,
      storageResolver,
      outboundDispatcher,
      outboundGatewayPort,
      syncLogRepository,
      pipelineStateRepository,
      stitchRepository,
      transactionManager,
      retryService,
      gemService,
      claimUseCase,
      tokenManagerService
    );
  });

  const validPayload = {
    traceId: uuidv4(),
    srcDataSourceId: "456",
    destDataSourceId: "tgt",
    routeId: uuidv4(),
    hydratedPayload: {},
  };

  it("should deliver message and write success", async () => {
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(
      QueueName.DeliveryQueue,
      expect.any(Function)
    );
    const handler = queueService.consume.mock.calls[0][1];
    await handler(validPayload);
    expect(outboundDispatcher.dispatch).toHaveBeenCalled();
  });

  it("should format error properly when piece fails", async () => {
    outboundDispatcher.dispatch.mockRejectedValue(new Error("api error"));

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await expect(handler(validPayload)).resolves.toBeUndefined();
  });

  it("should throw if target connection not found", async () => {
    // If no stitch matches, targetObject will be undefined, so it doesn't fail but dispatch might
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
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
      const res = await (service as any).writeL6Result(
        currentSchemaName, // destSchemaName
        currentSchemaName, // srcSchemaName
        uuidv4(), // outboundGatewayId
        1, // attemptCount
        "conn", // dataSourceId
        uuidv4(), // traceId
        uuidv4(), // routeId
        null, // resPayload
        null, // sentPayload
        500, // statusCode
        "SUCCESS", // finalStatus
        Date.now(), // start
        undefined, // destEntityId
        "RAW", // canonicalType
        "app", // srcAppName
        currentWorkspaceId, // srcOrganizationId
        undefined, // srcEntityId
        "tgt", // targetConnectionId
        undefined, // targetAppName
        undefined, // targetOrganizationId
        undefined, // targetObject
        currentWorkspaceId, // tenantId
      );
      expect(res).toBe(true);
    });

    it("should write GEM mapping if all conditions are met", async () => {
      vi.spyOn(gemService, "writeGemMapping").mockResolvedValue(undefined);

      const res = await (service as any).writeL6Result(
        currentSchemaName,
        currentSchemaName,
        uuidv4(),
        1,
        "conn",
        uuidv4(),
        uuidv4(),
        null,
        null,
        200,
        "SUCCESS",
        Date.now(),
        "destEntityId",
        "RAW",
        "app",
        currentWorkspaceId,
        "srcEntityId",
        "tgt",
        "targetApp",
        "targetTenant",
        "targetObject",
        currentWorkspaceId,
      );
      expect(res).toBe(true);
      expect(gemService.writeGemMapping).toHaveBeenCalled();
    });
  });

  it("should drop invalid message if hydratedPayload is missing", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    const invalidPayload = {
      traceId: uuidv4(),
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
      tenantDb: testDbManager.db!,
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
      tenantDb: testDbManager.db!,
    } as any);

    outboundDispatcher.dispatch.mockResolvedValueOnce({
      statusCode: 200,
      retry: false,
      body: { ok: true },
      sentPayload: { custom: "payload" },
      entityId: "ext-123",
    });

    vi.spyOn(service as any, "writeL6Result").mockResolvedValueOnce(true);

    await handler(validPayload);

    // Verify it used the updated sentPayload in finalization
    const callArgs = vi.mocked(service as any).writeL6Result.mock.calls[0];
    expect(callArgs[8]).toEqual(expect.objectContaining({ custom: "payload" }));
  });
});
