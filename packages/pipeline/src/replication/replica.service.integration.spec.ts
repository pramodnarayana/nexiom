import "reflect-metadata";
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { ReplicaService } from "./replica.service.js";
import { QueueService, QueueName } from "@soopa/queue";
import { TestDatabaseManager, dataSources } from "@soopa/database";
import { SqlDatabaseManager, SchemaPlan } from "@soopa/dbmanager";
import { v4 as uuidv4 } from "uuid";
import { sql } from "drizzle-orm";
import { DependenciesMissingError } from "@soopa/piece-framework";

describe("ReplicaService", () => {
  let service: ReplicaService;
  let queueService: any;
  let testDbManager: TestDatabaseManager;
  let storageResolver: any;
  let hookBroker: any;
  let replicaStatePort: any;
  let connectionRepositoryPort: any;

  beforeAll(async () => {
    testDbManager = new TestDatabaseManager();
    await testDbManager.start();
  }, 90000);

  afterAll(async () => {
    await testDbManager.stop();
  });

  let currentSchemaName: string;
  let currentWorkspaceId: string;

  beforeEach(async () => {
    currentSchemaName = "ws_" + uuidv4().replace(/-/g, "");
    currentWorkspaceId = uuidv4();

    // Clean global tables
    await testDbManager.db!.execute(sql`TRUNCATE TABLE data_source CASCADE`);

    const sqlManager = new SqlDatabaseManager(testDbManager.db!);
    await sqlManager.applyPlan(currentSchemaName, SchemaPlan.NAMESPACE_ONLY, { appName: "testApp", appProfile: "online" });
    await sqlManager.applyPlan(currentSchemaName, SchemaPlan.REPLICA_ACTIVE, { appName: "testApp", appProfile: "online" });

    queueService = {
      consume: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
    };

    hookBroker = {
      extractReplica: vi.fn().mockResolvedValue({
        entityType: "sf_Account",
        entityId: "mock-entity-id",
        data: {},
      }),
    };

    storageResolver = {
      resolveSchemaName: vi.fn().mockResolvedValue(currentSchemaName),
      resolveStorageProfile: vi
        .fn()
        .mockResolvedValue({ schemaName: currentSchemaName, tenantId: currentWorkspaceId }),
    };

    replicaStatePort = {
      fetchInboundRecord: vi.fn().mockResolvedValue({
        id: uuidv4(),
        traceId: "123",
        status: "RECEIVED",
        request: {},
      }),
      persistReplicaExtraction: vi.fn().mockResolvedValue(undefined),
      markInboundFail: vi.fn().mockResolvedValue(undefined),
    };

    connectionRepositoryPort = {
      getTenantConnectionMeta: vi.fn().mockResolvedValue({
        appName: "mock-app",
        appProfile: "revenova",
      }),
    };

    service = new ReplicaService(
      queueService,
      connectionRepositoryPort,
      replicaStatePort,
      storageResolver,
      hookBroker
    );
  });

  const seedDataSource = async (dataSourceId: string, metadata: any = { appProfile: "revenova" }) => {
    const tenantDb = testDbManager.db!;
    await tenantDb.execute(sql`SET LOCAL search_path TO ${sql.raw('"' + currentSchemaName + '"')}`);
    await tenantDb.insert(dataSources).values({
      id: dataSourceId,
      externalId: dataSourceId,
      displayName: "Mock App",
      tenantId: currentWorkspaceId,
      appName: "mock-app",
      metadata,
      vendorTenantId: "v1"
    });
  };

  it("should process message successfully and write to replicaOutbox atomically", async () => {
    service.onModuleInit();
    expect(queueService.consume.mock.calls[0][0]).toBe(QueueName.InboundQueue);
    
    const traceId = "123";
    const dataSourceId = uuidv4();
    await seedDataSource(dataSourceId);

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId, dataSourceId });

    expect(replicaStatePort.fetchInboundRecord).toHaveBeenCalledWith(
      currentWorkspaceId,
      currentSchemaName,
      traceId,
    );
    expect(replicaStatePort.persistReplicaExtraction).toHaveBeenCalled();
    const callArgs = replicaStatePort.persistReplicaExtraction.mock.calls[0];
    expect(callArgs[3]).toBe(traceId); // traceId
    expect(callArgs[5].entityId).toBe("mock-entity-id");
  });

  it("should handle errors gracefully and update sync log to FAIL", async () => {
    replicaStatePort.persistReplicaExtraction.mockRejectedValueOnce(
      new Error("db fail"),
    );
    
    const traceId = "123";
    const dataSourceId = uuidv4();
    await seedDataSource(dataSourceId);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId, dataSourceId }),
    ).rejects.toThrow("db fail");
    expect(replicaStatePort.markInboundFail).toHaveBeenCalled();
  });

  it("should throw if inbound record not found", async () => {
    replicaStatePort.fetchInboundRecord.mockResolvedValueOnce(null);
    
    const traceId = "123";
    const dataSourceId = uuidv4();
    await seedDataSource(dataSourceId);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId, dataSourceId }),
    ).rejects.toThrow("Inbound record for traceId 123 not found");
  });

  it("should throw if connection not found in dataSources", async () => {
    const traceId = "123";
    const dataSourceId = uuidv4();
    
    connectionRepositoryPort.getTenantConnectionMeta.mockResolvedValueOnce(null);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId, dataSourceId }),
    ).rejects.toThrow(DependenciesMissingError);
  });

  it("should throw if replica extraction fails due to payload shape mismatch", async () => {
    hookBroker.extractReplica.mockRejectedValueOnce(new Error("extract fail"));
    
    const traceId = "123";
    const dataSourceId = uuidv4();
    await seedDataSource(dataSourceId);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId, dataSourceId }),
    ).rejects.toThrow("extract fail");
  });

  it("should throw if extractor returns null (no stable entityId found)", async () => {
    hookBroker.extractReplica.mockResolvedValueOnce(null);
    
    const traceId = "123";
    const dataSourceId = uuidv4();
    await seedDataSource(dataSourceId);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId, dataSourceId }),
    ).rejects.toThrow("shard returned null");
  });

  it("should log nested error when error-handler transaction also fails", async () => {
    replicaStatePort.persistReplicaExtraction.mockRejectedValueOnce(
      new Error("db fail"),
    );
    replicaStatePort.markInboundFail.mockRejectedValueOnce(
      new Error("rollback fail"),
    );
    
    const traceId = "123";
    const dataSourceId = uuidv4();
    await seedDataSource(dataSourceId);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    const loggerSpy = vi.spyOn((service as any).logger, "error");
    await expect(
      handler({ traceId, dataSourceId }),
    ).rejects.toThrow("db fail");

    const output = loggerSpy.mock.calls.flat().map(String).join(" ");
    expect(output).toMatch(/Failed to write L2 error state/);
    loggerSpy.mockRestore();
  });

  it("should throw if extractor returns an entity with empty entityId", async () => {
    hookBroker.extractReplica.mockResolvedValueOnce({
      entityType: "DEFAULT",
      entityId: "",
      data: {},
    });
    
    const traceId = "123";
    const dataSourceId = uuidv4();
    await seedDataSource(dataSourceId);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId, dataSourceId }),
    ).rejects.toThrow("Cannot determine entityId");
  });

  it("should destroy module", () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });

  it("should skip processing if inbound record status is not RECEIVED or PENDING", async () => {
    replicaStatePort.fetchInboundRecord.mockResolvedValueOnce({
      id: "1",
      traceId: "123",
      status: "COMPLETED",
      request: {},
    });
    
    const traceId = "123";
    const dataSourceId = uuidv4();
    await seedDataSource(dataSourceId);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId, dataSourceId });

    expect(hookBroker.extractReplica).not.toHaveBeenCalled();
    expect(replicaStatePort.persistReplicaExtraction).not.toHaveBeenCalled();
  });

  it("should process inbound records with FAIL status (regression test)", async () => {
    replicaStatePort.fetchInboundRecord.mockResolvedValueOnce({
      id: "1",
      traceId: "123",
      status: "FAIL",
      request: {},
    });
    
    const traceId = "123";
    const dataSourceId = uuidv4();
    await seedDataSource(dataSourceId);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId, dataSourceId });

    expect(hookBroker.extractReplica).toHaveBeenCalled();
    expect(replicaStatePort.persistReplicaExtraction).toHaveBeenCalled();
  });
});
