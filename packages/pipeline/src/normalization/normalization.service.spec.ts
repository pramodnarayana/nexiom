import { describe, it, expect, vi, beforeEach } from "vitest";
import { NormalizationService } from "./normalization.service.js";
import { QueueName } from "@soopa/queue";
import { FakeNormalizationRepository } from "../shared/fakes/fake-normalization.repository.js";
import { FakeConnectionRepository } from "../shared/fakes/fake-connection.repository.js";
import { FakeTransactionManager } from "../shared/fakes/fake-transaction-manager.js";
import { FakeSyncLogRepository } from "../shared/fakes/fake-sync-log.repository.js";
import { v4 as uuidv4 } from "uuid";

describe("NormalizationService (Unit)", () => {
  let service: NormalizationService;
  let queueService: any;
  let hookBroker: any;
  let pieceRegistry: any;
  let storageResolver: any;
  
  let normRepo: FakeNormalizationRepository;
  let connRepo: FakeConnectionRepository;
  let txManager: FakeTransactionManager;
  let syncLogRepo: FakeSyncLogRepository;

  const currentSchemaName = "ws_testschema";
  const tenantId = "tenant_1";

  beforeEach(() => {
    queueService = { consume: vi.fn(), send: vi.fn().mockResolvedValue(undefined) };
    
    hookBroker = {
      normalize: vi.fn().mockResolvedValue(null),
      writeNormalized: vi.fn().mockResolvedValue(undefined),
      extractReplica: vi.fn().mockResolvedValue({ entityId: "test_entity_id" }),
      reverseLookup: vi.fn().mockResolvedValue(["parent_trace_1"]),
    };
    
    pieceRegistry = {
      getPiece: vi.fn().mockReturnValue({
        normalize: vi.fn().mockResolvedValue({ canonicalType: "TEST", data: {} }),
      }),
    };

    storageResolver = {
      resolveSchemaName: vi.fn().mockImplementation(() => currentSchemaName),
      resolveStorageProfile: vi.fn().mockImplementation(() => ({ schemaName: currentSchemaName, tenantId })),
    };

    normRepo = new FakeNormalizationRepository();
    connRepo = new FakeConnectionRepository();
    txManager = new FakeTransactionManager();
    syncLogRepo = new FakeSyncLogRepository();

    service = new NormalizationService(
      queueService,
      normRepo,
      connRepo,
      txManager,
      syncLogRepo,
      storageResolver,
      pieceRegistry,
      hookBroker
    );
  });

  const seedData = (traceId: string, dataSourceId: string, overrides: any = {}) => {
    connRepo.connections.push({
      dataSourceId,
      tenantId,
      appName: "test_app",
      appProfile: "standard",
    });

    if (overrides.skipReplica !== true) {
      normRepo.replicas.push({
        id: uuidv4(),
        dataSourceId,
        traceId: overrides.replicaTraceId ?? traceId,
        entityId: overrides.entityId ?? "test_entity_id",
        entityType: "test_entity",
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    if (overrides.skipInbound !== true) {
      normRepo.inboundRequests.push({
        schemaName: currentSchemaName,
        traceId,
        payload: { dummy: true },
      });
    }

    if (overrides.isSuperseded) {
      normRepo.supersededChecks.push({
        traceId,
        isSuperseded: true,
      });
    }
  };

  it("should process message normally and insert into normalized tables", async () => {
    const traceId = uuidv4();
    const dataSourceId = uuidv4();
    seedData(traceId, dataSourceId);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId, dataSourceId });

    expect(normRepo.normalizedEntities).toHaveLength(1);
    expect(normRepo.normalizedEntities[0].canonicalType).toBe("TEST");

    expect(normRepo.normalizedOutbox).toHaveLength(1);
    expect(normRepo.normalizedOutbox[0].status).toBe("SUCCESS");
    
    expect(queueService.send).toHaveBeenCalledWith(QueueName.NormalizedQueue, { traceId, dataSourceId });
  });

  it('uses resolved schema if passedSchemaName is not provided', async () => {
    const traceId = uuidv4();
    const dataSourceId = uuidv4();
    storageResolver.resolveStorageProfile.mockResolvedValue({ schemaName: 'ws_resolved', tenantId: 'ten-resolved' });
    connRepo.getTenantConnectionMeta = vi.fn().mockResolvedValue({
      appProfile: 'standard',
      appName: 'test-app',
      tenantId: 'ten-resolved',
      dataSourceId,
    });
    pieceRegistry.getPiece.mockReturnValue({ normalize: vi.fn().mockResolvedValue({ canonicalType: 'FOO', data: {} }) });
    
    // We can't easily mock findReplicaByTraceId on FakeNormalizationRepository since it's a real class method 
    // unless we spyOn it or add data. Let's just add data.
    connRepo.connections.push({ dataSourceId, tenantId: 'ten-resolved', appName: 'test-app', appProfile: 'standard' });
    normRepo.replicas.push({
      id: uuidv4(), dataSourceId, traceId, entityId: "e-1", entityType: "bar", data: {}, createdAt: new Date(), updatedAt: new Date()
    });

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId, dataSourceId });

    expect(storageResolver.resolveStorageProfile).toHaveBeenCalledWith(dataSourceId);
    expect(normRepo.normalizedEntities).toHaveLength(1);
  });

  it('uses normalizedFromShard if hookBroker.normalize returns a result', async () => {
    const traceId = uuidv4();
    const dataSourceId = uuidv4();
    connRepo.connections.push({ dataSourceId, tenantId: 'tenant_1', appName: 'test-app', appProfile: 'standard' });
    normRepo.replicas.push({
      id: uuidv4(), dataSourceId, traceId, entityId: "e-1", entityType: "bar", data: {}, createdAt: new Date(), updatedAt: new Date()
    });
    
    pieceRegistry.getPiece.mockReturnValue({ normalize: vi.fn() });
    hookBroker.normalize.mockResolvedValue({ canonicalType: 'SHARD_TYPE', data: { shard: true } });

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId, dataSourceId, schemaName: currentSchemaName });

    expect(normRepo.normalizedEntities).toHaveLength(1);
    expect(normRepo.normalizedEntities[0].canonicalType).toBe('SHARD_TYPE');
  });

  it('throws error if canonicalData fails serialization', async () => {
    const traceId = uuidv4();
    const dataSourceId = uuidv4();
    connRepo.connections.push({ dataSourceId, tenantId: 'tenant_1', appName: 'test-app', appProfile: 'standard' });
    normRepo.replicas.push({
      id: uuidv4(), dataSourceId, traceId, entityId: "e-1", entityType: "bar", data: {}, createdAt: new Date(), updatedAt: new Date()
    });
    
    const objWithCircularRef: any = {};
    objWithCircularRef.self = objWithCircularRef;

    pieceRegistry.getPiece.mockReturnValue({ normalize: vi.fn().mockResolvedValue({ canonicalType: 'FOO', data: objWithCircularRef }) });

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler({ traceId, dataSourceId, schemaName: currentSchemaName })).rejects.toThrow(/canonicalData is not JSON-serializable/);
  });

  it("should throw if globalDb target connection not found", async () => {
    const traceId = uuidv4();
    const dataSourceId = uuidv4();

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler({ traceId, dataSourceId })).rejects.toThrow("not found");
  });

  it("should handle superseded check logic and not insert normalized", async () => {
    const traceId = uuidv4();
    const otherTraceId = uuidv4();
    const dataSourceId = uuidv4();
    
    seedData(traceId, dataSourceId, { replicaTraceId: otherTraceId, isSuperseded: true });

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId, dataSourceId });

    expect(normRepo.normalizedEntities).toHaveLength(0);
    expect(queueService.send).not.toHaveBeenCalled();
  });

  it("should requeue parent from reverse lookup", async () => {
    const traceId = uuidv4();
    const dataSourceId = uuidv4();
    seedData(traceId, dataSourceId);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId, dataSourceId });

    expect(queueService.send).toHaveBeenCalledWith(QueueName.NormalizedQueue, {
      traceId: "parent_trace_1",
      dataSourceId,
    });
  });

  it("should catch and log error in application hook without throwing", async () => {
    const traceId = uuidv4();
    const dataSourceId = uuidv4();
    seedData(traceId, dataSourceId);

    hookBroker.writeNormalized.mockRejectedValueOnce(new Error("Hook failed"));
    
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId, dataSourceId });

    expect(normRepo.normalizedEntities).toHaveLength(1);
  });

  it("should leave outbox pending if queue service send fails", async () => {
    const traceId = uuidv4();
    const dataSourceId = uuidv4();
    seedData(traceId, dataSourceId);

    hookBroker.reverseLookup.mockResolvedValueOnce([]); // No parents
    queueService.send.mockRejectedValueOnce(new Error("Queue error"));
    
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId, dataSourceId });

    expect(normRepo.normalizedOutbox).toHaveLength(1);
    expect(normRepo.normalizedOutbox[0].status).toBe("PENDING");
  });
});
