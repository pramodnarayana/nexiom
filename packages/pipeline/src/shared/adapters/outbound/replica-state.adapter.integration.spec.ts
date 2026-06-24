import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { ReplicaStateAdapter } from './replica-state.adapter.js';
import { TestDatabaseManager, buildTenantSchema } from "@soopa/database";
import { SchemaPlan } from "@soopa/dbmanager";
import { v4 as uuidv4 } from "uuid";
import { MockDatabaseManager } from '../../../test-utils/mock-db-manager.js';

describe("ReplicaStateAdapter", () => {
  let adapter: ReplicaStateAdapter;
  let testDbManager: TestDatabaseManager;
  let dbManager: MockDatabaseManager;
  let currentSchemaName: string;
  const tenantId = "tenant_repl_test";

  beforeAll(async () => {
    testDbManager = new TestDatabaseManager();
    await testDbManager.start();
    dbManager = new MockDatabaseManager(testDbManager.db!);
  }, 60000);

  afterAll(async () => {
    await testDbManager.stop();
  });

  beforeEach(async () => {
    currentSchemaName = "ws_" + uuidv4().replace(/-/g, "");
    await dbManager.applyPlan(tenantId, currentSchemaName, SchemaPlan.SCHEMA_ACTIVE);
    adapter = new ReplicaStateAdapter(dbManager);
  }, 30000);

  it("should fetch inbound record", async () => {
    const traceId = uuidv4();
    const { inboundGateway } = buildTenantSchema(currentSchemaName);

    const tenantDb = testDbManager.db!;
    await tenantDb.insert(inboundGateway).values({
      id: uuidv4(),
      traceId,
      dataSourceId: uuidv4(),
      status: "PENDING",
      request: { method: "POST", body: {} },
    });

    const record = await adapter.fetchInboundRecord(tenantId, currentSchemaName, traceId);
    expect(record).toBeDefined();
    expect(record?.traceId).toBe(traceId);
    expect(record?.status).toBe("PENDING");
  });

  it("should return null for missing inbound record", async () => {
    const record = await adapter.fetchInboundRecord(tenantId, currentSchemaName, uuidv4());
    expect(record).toBeNull();
  });

  it("should persist replica extraction with locks", async () => {
    const traceId = uuidv4();
    const dataSourceId = uuidv4();
    const inboundId = uuidv4();
    const entityId = "ext_1";

    const { inboundGateway, replicaEntity, replicaOutbox, syncLog } = buildTenantSchema(currentSchemaName);
    const tenantDb = testDbManager.db!;

    // Seed inbound
    await tenantDb.insert(inboundGateway).values({
      id: inboundId,
      traceId,
      dataSourceId: dataSourceId,
      status: "PENDING",
      request: {},
    });

    await adapter.persistReplicaExtraction(
      tenantId,
      currentSchemaName,
      dataSourceId,
      traceId,
      inboundId,
      {
        entityId,
        entityType: "contact",
        data: { name: "test" },
      },
      100
    );

    // Verify
    const ib = await tenantDb.select().from(inboundGateway);
    expect(ib[0].status).toBe("REPLICATED");

    const re = await tenantDb.select().from(replicaEntity);
    expect(re).toHaveLength(1);
    expect(re[0].data).toEqual({ name: "test" });

    const sl = await tenantDb.select().from(syncLog);
    expect(sl).toHaveLength(1);
    expect(sl[0].layer).toBe("L2");

    const ro = await tenantDb.select().from(replicaOutbox);
    expect(ro).toHaveLength(1);
    expect(ro[0].status).toBe("PENDING");
  });

  it("should throw lock contention if another process holds the lock", async () => {
    const traceId1 = uuidv4();
    const traceId2 = uuidv4();
    const dataSourceId = uuidv4();
    const inboundId1 = uuidv4();
    const inboundId2 = uuidv4();
    const entityId = "ext_locked";

    const { inboundGateway } = buildTenantSchema(currentSchemaName);
    const tenantDb = testDbManager.db!;

    await tenantDb.insert(inboundGateway).values([
      { id: inboundId1, traceId: traceId1, dataSourceId: uuidv4(), status: "PENDING", request: {} },
      { id: inboundId2, traceId: traceId2, dataSourceId: uuidv4(), status: "PENDING", request: {} },
    ]);

    // First process acquires lock
    await adapter.persistReplicaExtraction(
      tenantId,
      currentSchemaName,
      dataSourceId,
      traceId1,
      inboundId1,
      { entityId, entityType: "contact", data: {} },
      100
    );

    // Second process tries to acquire same lock
    await expect(
      adapter.persistReplicaExtraction(
        tenantId,
        currentSchemaName,
        dataSourceId,
        traceId2,
        inboundId2,
        { entityId, entityType: "contact", data: {} },
        100
      )
    ).rejects.toThrow(/Entity ext_locked is currently locked by an in-flight sync/);
  });

  it("should mark inbound as FAIL", async () => {
    const traceId = uuidv4();
    const inboundId = uuidv4();

    const { inboundGateway, syncLog } = buildTenantSchema(currentSchemaName);
    const tenantDb = testDbManager.db!;

    await tenantDb.insert(inboundGateway).values({
      id: inboundId,
      traceId,
      dataSourceId: uuidv4(),
      status: "PENDING",
      request: {},
    });

    await adapter.markInboundFail(tenantId, currentSchemaName, traceId, "Test error", 150);

    const ib = await tenantDb.select().from(inboundGateway);
    expect(ib[0].status).toBe("FAIL");
    expect(ib[0].errorMessage).toBe("Test error");

    const sl = await tenantDb.select().from(syncLog);
    expect(sl[0].status).toBe("FAIL");
    expect(sl[0].errorMessage).toBe("Test error");
  });
});
