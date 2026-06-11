import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { TestDatabaseManager, buildTenantSchema, dataSources, globalEntityMap, fieldMappings, integrationStitches, uiWorkspaceDataSources, uiWorkspaces } from "@soopa/database";
import { SqlDatabaseManager, SchemaPlan } from "@soopa/dbmanager";

import { DrizzleConnectionRepositoryAdapter } from "./drizzle-connection.repository.js";
import { DrizzleFieldMappingRepositoryAdapter } from "./drizzle-field-mapping.repository.js";
import { DrizzleGlobalEntityMapRepositoryAdapter } from "./drizzle-global-entity-map.repository.js";
import { DrizzleOutboundGatewayRepositoryAdapter } from "./drizzle-outbound-gateway.repository.js";
import { DrizzlePipelineStateRepositoryAdapter } from "./drizzle-pipeline-state.repository.js";
import { DrizzleStitchRepositoryAdapter } from "./drizzle-stitch.repository.js";
import { DrizzleSyncLogRepositoryAdapter } from "./drizzle-sync-log.repository.js";
import { DrizzleTransactionManagerAdapter } from "./drizzle-transaction-manager.adapter.js";
import { sql } from "drizzle-orm";

describe("Fanout Drizzle Adapters", () => {
  let testDbManager: TestDatabaseManager;
  let mockDbManager: any;
  let currentSchemaName: string;
  let currentTenantId: string;

  let connectionAdapter: DrizzleConnectionRepositoryAdapter;
  let fieldMappingAdapter: DrizzleFieldMappingRepositoryAdapter;
  let gemAdapter: DrizzleGlobalEntityMapRepositoryAdapter;
  let outboxAdapter: DrizzleOutboundGatewayRepositoryAdapter;
  let stateAdapter: DrizzlePipelineStateRepositoryAdapter;
  let stitchAdapter: DrizzleStitchRepositoryAdapter;
  let syncLogAdapter: DrizzleSyncLogRepositoryAdapter;
  let txManagerAdapter: DrizzleTransactionManagerAdapter;

  beforeAll(async () => {
    testDbManager = new TestDatabaseManager();
    await testDbManager.start();

    // The test database runs global migrations, but global_entity_map is a tenant table
    // in the public schema of the tenant db. We manually create it here for the integration test.
    await testDbManager.db!.execute(sql`
      CREATE TABLE IF NOT EXISTS "global_entity_map" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "stitch_id" uuid NOT NULL REFERENCES "integration_stitch"("id") ON DELETE CASCADE,
        "source_app_name" varchar(255) DEFAULT 'unknown' NOT NULL,
        "source_data_source_id" uuid NOT NULL,
        "source_org_id" varchar(255) DEFAULT 'unknown' NOT NULL,
        "source_org_name" varchar(255) DEFAULT 'unknown' NOT NULL,
        "source_entity_type" varchar(255) DEFAULT 'unknown' NOT NULL,
        "source_entity_id" varchar(255) NOT NULL,
        "source_ref_layer" varchar(50) DEFAULT 'unspecified' NOT NULL,
        "source_trace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
        "dest_app_name" varchar(255) DEFAULT 'unknown' NOT NULL,
        "dest_data_source_id" uuid NOT NULL,
        "dest_org_id" varchar(255) DEFAULT 'unknown' NOT NULL,
        "dest_org_name" varchar(255) DEFAULT 'unknown' NOT NULL,
        "dest_entity_type" varchar(255) DEFAULT 'unknown' NOT NULL,
        "dest_entity_id" varchar(255) NOT NULL,
        "dest_ref_layer" varchar(50) DEFAULT 'unspecified' NOT NULL,
        "dest_trace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
        "last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);

    // Mock DB_MANAGER to return the testDbManager's db for getTenantDb
    mockDbManager = {
      getTenantDb: async (tenantId: string) => testDbManager.db,
    };

    connectionAdapter = new DrizzleConnectionRepositoryAdapter(testDbManager.db!, mockDbManager);
    fieldMappingAdapter = new DrizzleFieldMappingRepositoryAdapter(mockDbManager);
    gemAdapter = new DrizzleGlobalEntityMapRepositoryAdapter(testDbManager.db!, mockDbManager);
    outboxAdapter = new DrizzleOutboundGatewayRepositoryAdapter(mockDbManager);
    stateAdapter = new DrizzlePipelineStateRepositoryAdapter(mockDbManager);
    stitchAdapter = new DrizzleStitchRepositoryAdapter(mockDbManager);
    syncLogAdapter = new DrizzleSyncLogRepositoryAdapter(mockDbManager);
    txManagerAdapter = new DrizzleTransactionManagerAdapter(mockDbManager);
  }, 60000);

  afterAll(async () => {
    await testDbManager.stop();
  });

  beforeEach(async () => {
    currentSchemaName = "ws_" + uuidv4().replace(/-/g, "");
    currentTenantId = "tenant_" + uuidv4();
    const sqlManager = new SqlDatabaseManager(testDbManager.db!);
    await sqlManager.applyPlan(currentSchemaName, SchemaPlan.OUTBOUND_ACTIVE, { appName: "test_app", appProfile: "standard" });
  }, 30000);

  describe("DrizzleConnectionRepositoryAdapter", () => {
    it("should fetch global connection metadata", async () => {
      const dataSourceId = uuidv4();
      await testDbManager.db!.insert(dataSources).values({
        id: dataSourceId,
        tenantId: currentTenantId,
        appName: "salesforce",
        externalId: uuidv4(),
        displayName: "SFDC",
        schemaName: currentSchemaName,
      });

      const meta = await connectionAdapter.getGlobalConnectionMeta(dataSourceId);
      expect(meta).toEqual({ tenantId: currentTenantId });
    });

    it("should fetch tenant connection metadata with default profile", async () => {
      const dataSourceId = uuidv4();
      await testDbManager.db!.insert(dataSources).values({
        id: dataSourceId,
        tenantId: currentTenantId,
        appName: "salesforce",
        externalId: uuidv4(),
        displayName: "SFDC",
        schemaName: currentSchemaName,
        metadata: { someKey: "val" }
      });

      const meta = await connectionAdapter.getTenantConnectionMeta(dataSourceId, currentTenantId);
      expect(meta).toEqual({
        tenantId: currentTenantId,
        appName: "salesforce",
        appProfile: "standard"
      });
    });
  });

  describe("DrizzleFieldMappingRepositoryAdapter", () => {
    it("should fetch mapping rules", async () => {
      const stitchId = uuidv4();
      const workspaceId = uuidv4();
      const orgId = "org-" + uuidv4();

      await testDbManager.db!.insert(uiWorkspaces).values({
        id: workspaceId,
        orgId,
        name: "Test Workspace",
      });

      const sourceDataSourceId = uuidv4();
      const destDataSourceId = uuidv4();

      await testDbManager.db!.insert(dataSources).values([
        {
          id: sourceDataSourceId,
          tenantId: currentTenantId,
          appName: "test",
          externalId: uuidv4(),
          displayName: "Source",
          schemaName: currentSchemaName,
        },
        {
          id: destDataSourceId,
          tenantId: currentTenantId,
          appName: "test",
          externalId: uuidv4(),
          displayName: "Dest",
          schemaName: currentSchemaName,
        }
      ]);

      await testDbManager.db!.insert(integrationStitches).values({
        id: stitchId,
        name: "Test Stitch",
        orgId,
        workspaceId,
        sourceDataSourceId,
        destDataSourceId,
        canonicalObject: "Contact",
        targetObject: "Lead",
        syncCondition: [],
      });

      await testDbManager.db!.insert(fieldMappings).values({
        id: uuidv4(),
        stitchId,
        sourceCanonical: "Contact",
        mappingRules: [{ source: "FirstName", target: "first_name" }]
      });

      const rules = await fieldMappingAdapter.getMappingRules(currentTenantId, stitchId, "Contact");
      expect(rules).toEqual([{ source: "FirstName", target: "first_name" }]);
    });
  });

  describe("DrizzleGlobalEntityMapRepositoryAdapter", () => {
    it("should get destination entity id", async () => {
      const stitchId = uuidv4();
      const workspaceId = uuidv4();
      const orgId = "org-" + uuidv4();

      await testDbManager.db!.insert(uiWorkspaces).values({
        id: workspaceId,
        orgId,
        name: "Test Workspace",
      });

      const sourceDataSourceId = uuidv4();
      const destDataSourceId = uuidv4();

      await testDbManager.db!.insert(dataSources).values([
        {
          id: sourceDataSourceId,
          tenantId: currentTenantId,
          appName: "test",
          externalId: uuidv4(),
          displayName: "Source",
          schemaName: currentSchemaName,
        },
        {
          id: destDataSourceId,
          tenantId: currentTenantId,
          appName: "test",
          externalId: uuidv4(),
          displayName: "Dest",
          schemaName: currentSchemaName,
        }
      ]);

      await testDbManager.db!.insert(integrationStitches).values({
        id: stitchId,
        name: "Test Stitch",
        orgId,
        workspaceId,
        sourceDataSourceId,
        destDataSourceId,
        canonicalObject: "Contact",
        targetObject: "Lead",
        syncCondition: [],
      });
      
      await testDbManager.db!.insert(globalEntityMap).values({
        stitchId,
        sourceDataSourceId,
        destDataSourceId,
        sourceEntityId: "ext-1",
        destEntityId: "ext-2",
        sourceOrgId: "org-1",
        destOrgId: "org-2",
        sourceEntityType: "Contact",
        destEntityType: "Contact",
        sourceRefLayer: "L2",
        destRefLayer: "L6",
        sourceTraceId: uuidv4(),
        destTraceId: uuidv4(),
        sourceAppName: "test",
        destAppName: "test",
      });

      const destId = await gemAdapter.getDestinationEntityId(stitchId, sourceDataSourceId, "ext-1");
      expect(destId).toBe("ext-2");
    });
  });

  describe("DrizzleStitchRepositoryAdapter", () => {
    it("should find active stitches", async () => {
      const dataSourceId = uuidv4();
      const destDataSourceId = uuidv4();
      const stitchId = uuidv4();
      const workspaceId = uuidv4();
      const orgId = "org-" + uuidv4();

      await testDbManager.db!.insert(uiWorkspaces).values({
        id: workspaceId,
        orgId,
        name: "Test Workspace",
      });

      await testDbManager.db!.insert(dataSources).values([
        {
          id: dataSourceId,
          tenantId: currentTenantId,
          appName: "test",
          externalId: uuidv4(),
          displayName: "Source",
          schemaName: currentSchemaName,
        },
        {
          id: destDataSourceId,
          tenantId: currentTenantId,
          appName: "test",
          externalId: uuidv4(),
          displayName: "Dest",
          schemaName: currentSchemaName,
        }
      ]);

      await testDbManager.db!.insert(integrationStitches).values({
        id: stitchId,
        name: "Test Stitch",
        orgId,
        workspaceId,
        sourceDataSourceId: dataSourceId,
        destDataSourceId,
        canonicalObject: "Contact",
        targetObject: "Lead",
        syncCondition: [],
      });

      // uiWorkspaceDataSources is required by findActiveStitches query mapping!
      // wait, `findActiveStitches` joins `uiWorkspaceDataSources` to filter by workspace
      await testDbManager.db!.insert(uiWorkspaceDataSources).values({
        workspaceId,
        dataSourceId,
      });

      const stitches = await stitchAdapter.findActiveStitches(currentTenantId, dataSourceId, "Contact");
      expect(stitches).toHaveLength(1);
      expect(stitches[0].id).toBe(stitchId);
    });
  });

  describe("DrizzleOutboundGatewayRepositoryAdapter", () => {
    it("should upsert pending outbound gateway and return true for insert", async () => {
      const traceId = uuidv4();
      const routeId = uuidv4();

      const shouldPublish = await outboxAdapter.upsertPendingOutboundGateway(
        currentTenantId, currentSchemaName, traceId, routeId, uuidv4(), uuidv4(), { a: 1 }
      );

      expect(shouldPublish).toBe(true);

      const { outboundGateway } = buildTenantSchema(currentSchemaName);
      const rows = await testDbManager.db!.select().from(outboundGateway);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("PENDING");
    });
  });

  describe("DrizzleSyncLogRepositoryAdapter", () => {
    it("should write sync log", async () => {
      const traceId = uuidv4();
      const routeId = uuidv4();

      await syncLogAdapter.writeSyncLog(
        currentTenantId, currentSchemaName, traceId, routeId, "L4", "SUCCESS", 100
      );

      const { syncLog } = buildTenantSchema(currentSchemaName);
      const logs = await testDbManager.db!.select().from(syncLog);
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe("SUCCESS");
      expect(logs[0].durationMs).toBe(100);
    });
  });

  describe("DrizzleTransactionManagerAdapter", () => {
    it("should run work in tenant transaction with local search path", async () => {
      const result = await txManagerAdapter.runInTenantTransaction(currentTenantId, currentSchemaName, async (tx) => {
        const path = await tx.execute(sql`SHOW search_path`);
        return path.rows ? true : false;
      });
      
      expect(result).toBe(true);
    });
  });
});
