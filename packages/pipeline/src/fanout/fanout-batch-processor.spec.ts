import { describe, it, expect, vi, beforeEach } from "vitest";
import { FanoutBatchProcessor } from "./fanout-batch-processor.js";
import { ActiveStitch } from "../shared/ports/stitch.repository.port.js";
import { DependenciesMissingError } from "@soopa/piece-framework";

describe("FanoutBatchProcessor", () => {
  let processor: FanoutBatchProcessor;
  let queueService: any;
  let storageResolver: any;
  let targetBuilder: any;
  let eventEmitter: any;
  let connRepo: any;
  let stateRepo: any;
  let gemRepo: any;
  let fieldMappingRepo: any;
  let syncLogRepo: any;
  let outboxRepo: any;

  beforeEach(() => {
    queueService = { send: vi.fn() };
    storageResolver = { resolveSchemaName: vi.fn().mockResolvedValue("ws_123") };
    targetBuilder = { buildPayload: vi.fn().mockResolvedValue({ id: 1 }) };
    eventEmitter = { emitAsync: vi.fn() };
    
    connRepo = { getTenantConnectionMeta: vi.fn() };
    stateRepo = { getDestinationEntityState: vi.fn() };
    gemRepo = { getDestinationEntityId: vi.fn() };
    fieldMappingRepo = { getMappingRules: vi.fn() };
    syncLogRepo = { writeSyncLog: vi.fn() };
    outboxRepo = { 
      upsertPendingOutboundGateway: vi.fn(),
      upsertDeferredOutboundGateway: vi.fn(),
      markOutboundGatewayFailed: vi.fn()
    };

    processor = new FanoutBatchProcessor(
      queueService,
      storageResolver,
      targetBuilder,
      eventEmitter,
      connRepo,
      stateRepo,
      gemRepo,
      fieldMappingRepo,
      syncLogRepo,
      outboxRepo
    );
    
    // Mock internal broker for test isolation
    (processor as any).broker = { prepareUpdate: vi.fn().mockImplementation((a,b,payload) => payload) };
  });

  it("should process stitch successfully and send to DeliveryQueue", async () => {
    const stitch: ActiveStitch = {
      id: "st-1",
      name: "Test",
      orgId: "org-1",
      workspaceId: "ws-1",
      destDataSourceId: "ds-2",
      canonicalObject: "Contact",
      targetObject: "Lead",
      syncCondition: [],
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
      sourceDataSourceId: "ds-1"
    };

    fieldMappingRepo.getMappingRules.mockResolvedValue([{}]);
    connRepo.getTenantConnectionMeta.mockResolvedValue({ appName: "Salesforce", appProfile: "default" });
    outboxRepo.upsertPendingOutboundGateway.mockResolvedValue(true);

    const lockCount = { count: 1 };
    await processor.processSingleStitch(
      "ws_123", "tr-1", "ds-1", "src-app", "prof", "t-1", "ven-1", "Contact", {}, stitch, Date.now(), lockCount
    );

    expect(targetBuilder.buildPayload).toHaveBeenCalled();
    expect(outboxRepo.upsertPendingOutboundGateway).toHaveBeenCalled();
    expect(queueService.send).toHaveBeenCalled();
    expect(syncLogRepo.writeSyncLog).toHaveBeenCalledWith(
      "t-1", "ws_123", "tr-1", "st-1", "L4", "SUCCESS", expect.any(Number)
    );
    expect(lockCount.count).toBe(0); // decremented
  });

  it("should skip if no field mappings", async () => {
    fieldMappingRepo.getMappingRules.mockResolvedValue(null);
    const lockCount = { count: 1 };
    
    await processor.processSingleStitch(
      "ws_123", "tr-1", "ds-1", "src-app", "prof", "t-1", "ven-1", "Contact", {}, { syncCondition: [] } as any, Date.now(), lockCount
    );

    expect(targetBuilder.buildPayload).not.toHaveBeenCalled();
    expect(syncLogRepo.writeSyncLog).toHaveBeenCalledWith(
      "t-1", "ws_123", "tr-1", undefined, "L4", "SKIPPED", expect.any(Number)
    );
  });

  it("should skip if sync conditions do not match", async () => {
    const stitch = { id: "st-1", syncCondition: [{ field: "status", op: "eq", value: "ACTIVE" }] } as any;
    const lockCount = { count: 1 };
    
    await processor.processSingleStitch(
      "ws_123", "tr-1", "ds-1", "src-app", "prof", "t-1", "ven-1", "Contact", { status: "INACTIVE" }, stitch, Date.now(), lockCount
    );

    expect(syncLogRepo.writeSyncLog).toHaveBeenCalledWith(
      "t-1", "ws_123", "tr-1", "st-1", "L4", "SKIPPED", expect.any(Number)
    );
    expect(fieldMappingRepo.getMappingRules).not.toHaveBeenCalled();
  });

  it("should throw DependenciesMissingError if destConnMeta is missing", async () => {
    fieldMappingRepo.getMappingRules.mockResolvedValue([{}]);
    connRepo.getTenantConnectionMeta.mockResolvedValue(null);
    outboxRepo.upsertDeferredOutboundGateway.mockResolvedValue(true);
    const lockCount = { count: 1 };
    
    await processor.processSingleStitch(
      "ws_123", "tr-1", "ds-1", "src-app", "prof", "t-1", "ven-1", "Contact", {}, { id: "st-1", destDataSourceId: "ds-2", syncCondition: [] } as any, Date.now(), lockCount
    );

    expect(syncLogRepo.writeSyncLog).toHaveBeenCalledWith(
      "t-1", "ws_123", "tr-1", "st-1", "L4", "SKIPPED", expect.any(Number)
    );
    expect(outboxRepo.upsertDeferredOutboundGateway).toHaveBeenCalledWith("t-1", "ws_123", "tr-1", "st-1", "ds-2", "ds-1");
  });

  it("should handle generic errors and fail route", async () => {
    fieldMappingRepo.getMappingRules.mockRejectedValue(new Error("DB Connection Lost"));
    const lockCount = { count: 1 };
    
    await processor.processSingleStitch(
      "ws_123", "tr-1", "ds-1", "src-app", "prof", "t-1", "ven-1", "Contact", {}, { id: "st-1", destDataSourceId: "ds-2", syncCondition: [] } as any, Date.now(), lockCount
    );

    expect(syncLogRepo.writeSyncLog).toHaveBeenCalledWith(
      "t-1", "ws_123", "tr-1", "st-1", "L4", "FAIL", expect.any(Number), "DB Connection Lost"
    );
  });

  it("should skip publishing to MQ if outboxRepo returns false for shouldPublish", async () => {
    fieldMappingRepo.getMappingRules.mockResolvedValue([{}]);
    connRepo.getTenantConnectionMeta.mockResolvedValue({ appName: "Salesforce", appProfile: "default" });
    outboxRepo.upsertPendingOutboundGateway.mockResolvedValue(false);
    
    const lockCount = { count: 1 };
    
    await processor.processSingleStitch(
      "ws_123", "tr-1", "ds-1", "src-app", "prof", "t-1", "ven-1", "Contact", {}, { id: "st-1", destDataSourceId: "ds-2", syncCondition: [] } as any, Date.now(), lockCount
    );

    expect(queueService.send).not.toHaveBeenCalled();
    expect(syncLogRepo.writeSyncLog).not.toHaveBeenCalledWith(
      "t-1", "ws_123", "tr-1", "st-1", "L4", "SUCCESS", expect.any(Number)
    );
  });

  it("should load destState if gemDestId is found", async () => {
    fieldMappingRepo.getMappingRules.mockResolvedValue([{}]);
    connRepo.getTenantConnectionMeta.mockResolvedValue({ appName: "Salesforce", appProfile: "default" });
    gemRepo.getDestinationEntityId.mockResolvedValue("dest-id-1");
    stateRepo.getDestinationEntityState.mockResolvedValue({ SyncToken: "token-1" });
    outboxRepo.upsertPendingOutboundGateway.mockResolvedValue(true);
    
    const lockCount = { count: 1 };
    
    await processor.processSingleStitch(
      "ws_123", "tr-1", "ds-1", "src-app", "prof", "t-1", "ven-1", "Contact", {}, { id: "st-1", destDataSourceId: "ds-2", syncCondition: [] } as any, Date.now(), lockCount
    );

    expect(stateRepo.getDestinationEntityState).toHaveBeenCalled();
    expect((processor as any).broker.prepareUpdate).toHaveBeenCalledWith(
      "Salesforce", "default", expect.any(Object), "dest-id-1", { SyncToken: "token-1" }
    );
  });
});
