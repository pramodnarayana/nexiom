import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RegistryReplicationAdapter } from './registry-replication.adapter.js';
import { TestDatabaseManager, globalRegistryOutbox, dataSources, uiWorkspaces, integrationStitches, fieldMappings } from "@soopa/database";
import { SchemaPlan } from "@soopa/dbmanager";
import { v4 as uuidv4 } from "uuid";
import { MockDatabaseManager } from '../../../test-utils/mock-db-manager.js';
import { eq } from "drizzle-orm";

describe("RegistryReplicationAdapter", () => {
  let adapter: RegistryReplicationAdapter;
  let testDbManager: TestDatabaseManager;
  let dbManager: MockDatabaseManager;

  beforeAll(async () => {
    testDbManager = new TestDatabaseManager();
    await testDbManager.start();
    dbManager = new MockDatabaseManager(testDbManager.db!);
    let tenantId = uuidv4();
    const currentSchemaName = "ws_test_tenant";
    await dbManager.applyPlan(tenantId, currentSchemaName, SchemaPlan.STANDARD_ACTIVE, {
      appName: "test_app",
      appProfile: "standard",
    });

    adapter = new RegistryReplicationAdapter(testDbManager.db!, dbManager);
  }, 60000);

  afterAll(async () => {
    await testDbManager.stop();
  });

  describe("Global Outbox Operations", () => {
    it("should fetch a global outbox record", async () => {
      const outboxId = uuidv4();
      const testTenantId = uuidv4();
      const testEntityId = uuidv4();
      await testDbManager.db!.insert(globalRegistryOutbox).values({
        id: outboxId,
        tenantId: testTenantId,
        entityType: "APP_CONNECTION",
        entityId: testEntityId,
        action: "UPSERT",
        payload: { foo: "bar" },
        status: "PENDING",
      });

      const record = await adapter.fetchGlobalOutboxRecord(outboxId);
      expect(record).toBeDefined();
      expect(record?.id).toBe(outboxId);
      expect(record?.payload).toEqual({ foo: "bar" });
    });

    it("should return null for non-existent outbox record", async () => {
      const record = await adapter.fetchGlobalOutboxRecord(uuidv4());
      expect(record).toBeNull();
    });

    it("should mark global outbox as SUCCESS", async () => {
      const outboxId = uuidv4();
      const testTenantId = uuidv4();
      const testEntityId = uuidv4();
      await testDbManager.db!.insert(globalRegistryOutbox).values({
        id: outboxId,
        tenantId: testTenantId,
        entityType: "APP_CONNECTION",
        entityId: testEntityId,
        action: "UPSERT",
        payload: {},
        status: "PENDING",
      });

      await adapter.markGlobalOutboxSuccess(outboxId);

      const rows = await testDbManager.db!.select().from(globalRegistryOutbox).where(eq(globalRegistryOutbox.id, outboxId));
      expect(rows[0].status).toBe("SUCCESS");
    });
  });

  describe("Entity Replication", () => {
    const tenantId = uuidv4();

    it("should UPSERT and DELETE APP_CONNECTION", async () => {
      const connId = uuidv4();
      
      await adapter.replicateEntity(tenantId, "UPSERT", "APP_CONNECTION", connId, {
        id: connId,
        tenantId,
        appName: "test_app",
        externalId: "ext1",
        displayName: "Test Conn",
        metadata: {},
        schemaName: "should_be_stripped", // Testing prepareAppConnectionPayload
        schemaPlan: "also_stripped",
      });

      const rows = await testDbManager.db!.select().from(dataSources).where(eq(dataSources.id, connId));
      expect(rows).toHaveLength(1);
      expect(rows[0].appName).toBe("test_app");
      expect(rows[0].schemaName).toBeNull(); // Because schemaName was stripped

      await adapter.replicateEntity(tenantId, "DELETE", "APP_CONNECTION", connId, null);
      
      const afterDelete = await testDbManager.db!.select().from(dataSources).where(eq(dataSources.id, connId));
      expect(afterDelete).toHaveLength(0);
    });

    it("should UPSERT and DELETE UI_WORKSPACE", async () => {
      const wsId = uuidv4();
      const payload = {
        id: wsId,
        tenantId,
        orgId: uuidv4(),
        name: "Test Workspace",
        description: "Desc",
      };

      await adapter.replicateEntity(tenantId, "UPSERT", "UI_WORKSPACE", wsId, payload);
      
      let rows = await testDbManager.db!.select().from(uiWorkspaces).where(eq(uiWorkspaces.id, wsId));
      expect(rows).toHaveLength(1);

      await adapter.replicateEntity(tenantId, "DELETE", "UI_WORKSPACE", wsId, null);
      
      rows = await testDbManager.db!.select().from(uiWorkspaces).where(eq(uiWorkspaces.id, wsId));
      expect(rows).toHaveLength(0);
    });

    it("should UPSERT and DELETE INTEGRATION_STITCH", async () => {
      const stitchId = uuidv4();
      const orgId = uuidv4();
      const workspaceId = uuidv4();

      await adapter.replicateEntity(tenantId, "UPSERT", "UI_WORKSPACE", workspaceId, {
        id: workspaceId,
        tenantId,
        orgId,
        name: "Test Workspace",
        description: "Desc",
      });

      // First create mock data sources due to foreign keys
      const srcDsId = uuidv4();
      const destDsId = uuidv4();
      await adapter.replicateEntity(tenantId, "UPSERT", "APP_CONNECTION", srcDsId, {
        id: srcDsId, tenantId, appName: "src", externalId: "1", displayName: "src"
      });
      await adapter.replicateEntity(tenantId, "UPSERT", "APP_CONNECTION", destDsId, {
        id: destDsId, tenantId, appName: "dest", externalId: "2", displayName: "dest"
      });

      const payload = {
        id: stitchId,
        tenantId,
        name: "Test Stitch",
        orgId,
        workspaceId,
        sourceDataSourceId: srcDsId,
        destDataSourceId: destDsId,
        canonicalObject: "Contact",
        targetObject: "Contact",
        isActive: true,
        status: "ACTIVE",
      };

      await adapter.replicateEntity(tenantId, "UPSERT", "INTEGRATION_STITCH", stitchId, payload);
      
      let rows = await testDbManager.db!.select().from(integrationStitches).where(eq(integrationStitches.id, stitchId));
      expect(rows).toHaveLength(1);

      await adapter.replicateEntity(tenantId, "DELETE", "INTEGRATION_STITCH", stitchId, null);
      
      rows = await testDbManager.db!.select().from(integrationStitches).where(eq(integrationStitches.id, stitchId));
      expect(rows).toHaveLength(0);
    });

    it("should rehydrate dates during UPSERT", async () => {
      const connId = uuidv4();
      const dateStr = "2023-10-01T12:00:00.000Z";
      
      await adapter.replicateEntity(tenantId, "UPSERT", "APP_CONNECTION", connId, {
        id: connId,
        tenantId,
        appName: "test_dates",
        externalId: "ext_d",
        displayName: "Date Conn",
        createdAt: dateStr, // This string should be converted to Date
      });

      const rows = await testDbManager.db!.select().from(dataSources).where(eq(dataSources.id, connId));
      expect(rows).toHaveLength(1);
      expect(rows[0].createdAt).toBeInstanceOf(Date);
      expect(rows[0].createdAt!.toISOString()).toBe(dateStr);
    });

    it("should fetch stitch data sources", async () => {
      const srcId = uuidv4();
      const destId = uuidv4();

      await adapter.replicateEntity(tenantId, "UPSERT", "APP_CONNECTION", srcId, {
        id: srcId, tenantId, appName: "app_src", externalId: "s", displayName: "S"
      });
      await adapter.replicateEntity(tenantId, "UPSERT", "APP_CONNECTION", destId, {
        id: destId, tenantId, appName: "app_dest", externalId: "d", displayName: "D"
      });

      const ds = await adapter.getStitchDataSources(tenantId, srcId, destId);
      expect(ds).toHaveLength(2);
      expect(ds.map(d => d.id).sort()).toEqual([srcId, destId].sort());
    });
  });
});
