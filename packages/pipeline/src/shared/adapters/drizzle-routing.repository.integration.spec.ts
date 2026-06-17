import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DrizzleRoutingRepositoryAdapter } from "./drizzle-routing.repository.js";
import { TestDatabaseManager, buildTenantSchema, dataSources } from "@soopa/database";
import { v4 as uuidv4 } from "uuid";
import { SqlDatabaseManager, SchemaPlan } from "@soopa/dbmanager";

describe("DrizzleRoutingRepositoryAdapter", () => {
  let adapter: DrizzleRoutingRepositoryAdapter;
  let testDbManager: TestDatabaseManager;
  let currentSchemaName: string;

  beforeAll(async () => {
    testDbManager = new TestDatabaseManager();
    await testDbManager.start();
    adapter = new DrizzleRoutingRepositoryAdapter(testDbManager.db!);
  }, 60000);

  afterAll(async () => {
    await testDbManager.stop();
  });

  beforeEach(async () => {
    currentSchemaName = "ws_" + uuidv4().replace(/-/g, "");
    const sqlManager = new SqlDatabaseManager(testDbManager.db!);
    await sqlManager.applyPlan(currentSchemaName, SchemaPlan.STANDARD_ACTIVE, { appName: "test_app", appProfile: "standard" });
  }, 30000);

  it("should return found if normalized entity exists", async () => {
    const traceId = uuidv4();
    const dataSourceId = uuidv4();
    const tenantSchema = buildTenantSchema(currentSchemaName);

    await testDbManager.db!.insert(dataSources).values({
      id: dataSourceId,
      tenantId: "tenant_1",
      appName: "test_app",
      externalId: uuidv4(),
      displayName: uuidv4(),
      schemaName: currentSchemaName,
    });

    const replicaId = uuidv4();
    await testDbManager.db!.insert(tenantSchema.replicaEntity).values({
      id: replicaId,
      dataSourceId,
      traceId,
      entityId: "test_entity",
      entityType: "test_type",
      data: {},
    });

    await testDbManager.db!.insert(tenantSchema.normalizedEntity).values({
      id: uuidv4(),
      traceId,
      replicaId,
      canonicalType: "TEST",
      data: {},
    });

    const result = await adapter.hasNormalizedRecord(traceId, currentSchemaName);
    expect(result).toBe(true);
  });

  it("should return superseded if normalized entity doesn't exist but another trace normalized it", async () => {
    const traceId = uuidv4();
    const otherTraceId = uuidv4();
    const dataSourceId = uuidv4();
    const tenantSchema = buildTenantSchema(currentSchemaName);

    await testDbManager.db!.insert(dataSources).values({
      id: dataSourceId,
      tenantId: "tenant_1",
      appName: "test_app",
      externalId: uuidv4(),
      displayName: uuidv4(),
      schemaName: currentSchemaName,
    });

    const replicaId = uuidv4();
    // Insert replica with the current traceId
    await testDbManager.db!.insert(tenantSchema.replicaEntity).values({
      id: replicaId,
      dataSourceId,
      traceId,
      entityId: "test_entity",
      entityType: "test_type",
      data: {},
    });

    // Insert normalized record with a DIFFERENT traceId for the SAME replica
    await testDbManager.db!.insert(tenantSchema.normalizedEntity).values({
      id: uuidv4(),
      traceId: otherTraceId,
      replicaId,
      canonicalType: "TEST",
      data: {},
    });

    const hasNormalized = await adapter.hasNormalizedRecord(traceId, currentSchemaName);
    expect(hasNormalized).toBe(false);

    const retrievedReplicaId = await adapter.getReplicaIdByTraceId(traceId, currentSchemaName);
    expect(retrievedReplicaId).toEqual(replicaId);

    const hasSuperseding = await adapter.hasSupersedingNormalizedRecord(replicaId, traceId, currentSchemaName);
    expect(hasSuperseding).toBe(true);
  });

  it("should throw error if normalized entity doesn't exist and no superseding trace exists", async () => {
    const traceId = uuidv4();
    const dataSourceId = uuidv4();
    const tenantSchema = buildTenantSchema(currentSchemaName);

    await testDbManager.db!.insert(dataSources).values({
      id: dataSourceId,
      tenantId: "tenant_1",
      appName: "test_app",
      externalId: uuidv4(),
      displayName: uuidv4(),
      schemaName: currentSchemaName,
    });

    const replicaId = uuidv4();
    await testDbManager.db!.insert(tenantSchema.replicaEntity).values({
      id: replicaId,
      dataSourceId,
      traceId,
      entityId: "test_entity",
      entityType: "test_type",
      data: {},
    });

    const hasNormalized = await adapter.hasNormalizedRecord(traceId, currentSchemaName);
    expect(hasNormalized).toBe(false);

    const retrievedReplicaId = await adapter.getReplicaIdByTraceId(traceId, currentSchemaName);
    expect(retrievedReplicaId).toEqual(replicaId);

    const hasSuperseding = await adapter.hasSupersedingNormalizedRecord(replicaId, traceId, currentSchemaName);
    expect(hasSuperseding).toBe(false);
  });
});
