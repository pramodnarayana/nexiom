import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { OutboundGatewayAdapter } from './outbound-gateway.adapter.js';
import { TestDatabaseManager, buildTenantSchema } from "@soopa/database";
import { SchemaPlan } from "@soopa/dbmanager";
import { v4 as uuidv4 } from "uuid";
import { MockDatabaseManager } from '../../../test-utils/mock-db-manager.js';

describe("OutboundGatewayAdapter", () => {
  let adapter: OutboundGatewayAdapter;
  let testDbManager: TestDatabaseManager;
  let dbManager: MockDatabaseManager;
  let currentSchemaName: string;
  let tenantId: string;

  beforeAll(async () => {
    testDbManager = new TestDatabaseManager();
    await testDbManager.start();
    dbManager = new MockDatabaseManager(testDbManager.db!);
    tenantId = "tenant_test";

    adapter = new OutboundGatewayAdapter(dbManager);
  }, 60000);

  afterAll(async () => {
    await testDbManager.stop();
  });

  beforeEach(async () => {
    currentSchemaName = "ws_" + uuidv4().replace(/-/g, "");
    await dbManager.applyPlan(tenantId, currentSchemaName, SchemaPlan.STANDARD_ACTIVE, {
      appName: "test_app",
      appProfile: "standard",
    });
  }, 30000);

  it("should insert a new pending record and return its details", async () => {
    const traceId = uuidv4();
    const routeId = uuidv4();
    const dataSourceId = uuidv4();
    const srcDataSourceId = uuidv4();

    const result = await adapter.insertOrFetchPending(tenantId, currentSchemaName, {
      traceId,
      routeId,
      dataSourceId,
      srcDataSourceId,
      payload: { foo: "bar" },
    });

    expect(result.id).toBeDefined();
    expect(result.attempts).toBe(0);
    expect(result.status).toBe("PENDING");
  });

  it("should claim a pending record for processing", async () => {
    const traceId = uuidv4();
    const routeId = uuidv4();

    const { id } = await adapter.insertOrFetchPending(tenantId, currentSchemaName, {
      traceId,
      routeId,
      dataSourceId: uuidv4(),
      srcDataSourceId: uuidv4(),
      payload: {},
    });

    const claimRes = await adapter.claimForProcessing(tenantId, currentSchemaName, id);

    expect(claimRes.claimed).toBe(true);
    expect(claimRes.attemptCount).toBe(1);

    // Second claim should fail
    const secondClaim = await adapter.claimForProcessing(tenantId, currentSchemaName, id);
    expect(secondClaim.claimed).toBe(false);
  });

  it("should mark result as SUCCESS and create replica if requested", async () => {
    const traceId = uuidv4();
    const routeId = uuidv4();
    const destDataSourceId = uuidv4();

    const { id, attempts } = await adapter.insertOrFetchPending(tenantId, currentSchemaName, {
      traceId,
      routeId,
      dataSourceId: destDataSourceId,
      srcDataSourceId: uuidv4(),
      payload: {},
    });

    const claimRes = await adapter.claimForProcessing(tenantId, currentSchemaName, id);

    await adapter.markResult(
      tenantId,
      currentSchemaName,
      id,
      claimRes.attemptCount,
      "SUCCESS",
      201,
      { created: true },
      { sent: "yes" },
      "ext_123",
      {
        traceId,
        dataSourceId: destDataSourceId,
        targetObject: "contact",
      }
    );

    // Verify DB state
    const tenantDb = testDbManager.db!;
    const { replicaEntity, outboundGateway } = buildTenantSchema(currentSchemaName);

    const ob = await tenantDb.select().from(outboundGateway);
    expect(ob[0].status).toBe("SUCCESS");
    expect(ob[0].statusCode).toBe(201);
    expect(ob[0].destVendorId).toBe("ext_123");

    const rep = await tenantDb.select().from(replicaEntity);
    expect(rep).toHaveLength(1);
    expect(rep[0].entityId).toBe("ext_123");
    expect(rep[0].data).toEqual({ created: true });
  });

  it("should throw error if marking result on stale attempt", async () => {
    const traceId = uuidv4();
    const routeId = uuidv4();

    const { id } = await adapter.insertOrFetchPending(tenantId, currentSchemaName, {
      traceId,
      routeId,
      dataSourceId: uuidv4(),
      srcDataSourceId: uuidv4(),
      payload: {},
    });

    const claimRes = await adapter.claimForProcessing(tenantId, currentSchemaName, id);

    await expect(
      adapter.markResult(
        tenantId,
        currentSchemaName,
        id,
        claimRes.attemptCount + 1, // Stale attempt count
        "FAIL",
        500,
        null,
        null
      )
    ).rejects.toThrow(/lost claim race/);
  });
});
