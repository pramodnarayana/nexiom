import { describe, it, expect, vi, beforeEach } from "vitest";
import { FanoutRouterService } from "./fanout-router.service.js";

describe("FanoutRouterService", () => {
  let service: FanoutRouterService;
  let queueService: any;
  let storageResolver: any;
  let dbManager: any;
  let batchProcessor: any;
  let routingDecisionEngine: any;
  let connRepo: any;
  let stateRepo: any;
  let stitchRepo: any;
  let txManager: any;

  beforeEach(() => {
    queueService = { consume: vi.fn(), send: vi.fn() };
    storageResolver = { resolveSchemaName: vi.fn().mockResolvedValue("ws_123") };
    dbManager = { getTenantDb: vi.fn().mockResolvedValue({}) };
    batchProcessor = { 
      processSingleStitch: vi.fn().mockImplementation((_1,_2,_3,_4,_5,_6,_7,_8,_9,_10,_11, lockRefCount) => {
        lockRefCount.count--;
      }) 
    };
    routingDecisionEngine = { evaluateSuperseded: vi.fn() };
    
    connRepo = { 
      getGlobalConnectionMeta: vi.fn(),
      getTenantConnectionMeta: vi.fn()
    };
    stateRepo = {
      getNormalizedData: vi.fn(),
      getReplicaSourceVendorId: vi.fn(),
      releaseSyncLock: vi.fn()
    };
    stitchRepo = { findActiveStitches: vi.fn() };
    txManager = {
      runInTenantTransaction: vi.fn().mockImplementation(async (tenantId, schemaName, work) => {
        return await work({ execute: vi.fn().mockResolvedValue({ rows: [{}] }) }); // Fake tx
      })
    };

    service = new FanoutRouterService(
      queueService,
      storageResolver,
      dbManager,
      batchProcessor,
      routingDecisionEngine,
      connRepo,
      stateRepo,
      stitchRepo,
      txManager
    );
  });

  it("should ignore invalid messages", async () => {
    await (service as any).processMessage({ missingTraceId: true });
    expect(connRepo.getGlobalConnectionMeta).not.toHaveBeenCalled();
  });

  it("should process valid message and route to batch processor", async () => {
    connRepo.getGlobalConnectionMeta.mockResolvedValue({ tenantId: "t-1" });
    routingDecisionEngine.evaluateSuperseded.mockResolvedValue({ kind: "found" });
    stateRepo.getNormalizedData.mockResolvedValue({ data: { a: 1 }, canonicalType: "Contact" });
    stateRepo.getReplicaSourceVendorId.mockResolvedValue("vendor-123");
    
    stitchRepo.findActiveStitches.mockResolvedValue([
      { id: "stitch-1", destDataSourceId: "dest-1", targetObject: "Lead" }
    ]);
    connRepo.getTenantConnectionMeta.mockResolvedValue({ appName: "Salesforce", appProfile: "default" });

    await (service as any).processMessage({ traceId: "tr-1", dataSourceId: "ds-1" });

    expect(batchProcessor.processSingleStitch).toHaveBeenCalledTimes(1);
    expect(stateRepo.releaseSyncLock).toHaveBeenCalledWith("ds-1", "vendor-123", "ws_123", "t-1");
  });

  it("should abort if superseded", async () => {
    connRepo.getGlobalConnectionMeta.mockResolvedValue({ tenantId: "t-1" });
    stateRepo.getReplicaSourceVendorId.mockResolvedValue("vendor-123");
    routingDecisionEngine.evaluateSuperseded.mockResolvedValue({ kind: "superseded" });

    await (service as any).processMessage({ traceId: "tr-1", dataSourceId: "ds-1" });

    expect(stitchRepo.findActiveStitches).not.toHaveBeenCalled();
  });
});
