import { Test, TestingModule } from "@nestjs/testing";
import { GemHydrationService } from "./gem-hydration.service.js";
import { GemMappingParams } from "../shared/ports/global-entity-map.repository.port.js";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  TestDatabaseManager,
  uiWorkspaces,
  dataSources,
  integrationStitches,
  globalEntityMap,
  DATABASE_CONNECTION,
} from "@soopa/database";
import { SchemaPlan } from "@soopa/dbmanager";
import { DB_MANAGER } from "@soopa/dbmanager";
import { MockDatabaseManager } from "../test-utils/mock-db-manager.js";
import { sql } from "drizzle-orm";
import { DrizzleGlobalEntityMapRepositoryAdapter } from "../shared/adapters/outbound/drizzle-global-entity-map.adapter.js";

describe("GemHydrationService", () => {
  let service: GemHydrationService;
  let testDbManager: TestDatabaseManager;
  let dbManager: MockDatabaseManager;

  beforeAll(async () => {
    testDbManager = new TestDatabaseManager();
    await testDbManager.start();
    dbManager = new MockDatabaseManager(testDbManager.db!);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GemHydrationService,
        {
          provide: "GlobalEntityMapRepositoryPort",
          useClass: DrizzleGlobalEntityMapRepositoryAdapter,
        },
        {
          provide: DB_MANAGER,
          useValue: dbManager,
        },
        {
          provide: DATABASE_CONNECTION,
          useValue: testDbManager.db!,
        },
      ],
    }).compile();

    service = module.get<GemHydrationService>(GemHydrationService);
  }, 90000);

  afterAll(async () => {
    if (testDbManager) {
      await testDbManager.stop();
    }
  });

  it("should write gem mapping successfully and handle conflicts", async () => {
    // 1. Setup global dependencies (workspace, datasources, stitch)
    const wsId = uuidv4();
    const orgId = uuidv4();
    await testDbManager.db!.insert(uiWorkspaces).values({
      id: wsId,
      orgId: orgId,
      name: "GEM Test WS",
    });

    const srcDsId = uuidv4();
    await testDbManager.db!.insert(dataSources).values({
      id: srcDsId,
      tenantId: wsId,
      externalId: uuidv4(),
      displayName: "MockApp",
      appName: "MockApp",
    });

    const destDsId = uuidv4();
    await testDbManager.db!.insert(dataSources).values({
      id: destDsId,
      tenantId: wsId,
      externalId: uuidv4(),
      displayName: "Hubspot",
      appName: "Hubspot",
    });

    const routeId = uuidv4();
    await testDbManager.db!.insert(integrationStitches).values({
      id: routeId,
      name: "Test Stitch",
      orgId: orgId,
      workspaceId: wsId,
      sourceDataSourceId: srcDsId,
      destDataSourceId: destDsId,
      canonicalObject: "Contact",
      targetObject: "Contact",
    });

    // 2. Setup tenant schema
    const tenantId = "ten1";
    const schemaName = `ws_${tenantId.replace(/-/g, "_")}`;
    await dbManager.applyPlan(tenantId, schemaName, SchemaPlan.STANDARD_ACTIVE, {
      appName: "testApp",
      appProfile: "default",
    });
    const tenantDb = testDbManager.db!;
    
    // The table is already managed by drizzle migrations run in global-setup.ts
    const params: GemMappingParams = {
      traceId: uuidv4(),
      routeId,
      srcAppName: "MockApp",
      dataSourceId: srcDsId,
      srcTenantId: tenantId,
      canonicalType: "Contact",
      srcVendorId: "v1",
      targetAppName: "Hubspot",
      targetConnectionId: destDsId,
      targetTenantId: "ten2",
      destVendorId: "dv1",
    };

    await service.writeGemMapping(tenantId, params);

    // 4. Assert mapping was inserted
    await tenantDb.transaction(async (tx: any) => {
      const result1 = await tx
        .select()
        .from(globalEntityMap)
        .where(
          (t: any) =>
            t.stitchId === routeId &&
            t.sourceEntityId === "v1" &&
            t.destEntityId === "dv1"
        );

      expect(result1.length).toBe(1);
      expect(result1[0].sourceAppName).toBe("MockApp");
      expect(result1[0].destAppName).toBe("Hubspot");
      expect(result1[0].sourceTraceId).toBe(params.traceId);
    });

    // 5. Update mapping (upsert behavior)
    const newTraceId = uuidv4();
    const updateParams: GemMappingParams = {
      ...params,
      traceId: newTraceId,
      destVendorId: "dv2", // Updating the dest entity id
    };

    await service.writeGemMapping(tenantId, updateParams);

    // 6. Assert mapping was updated, not duplicated
    await tenantDb.transaction(async (tx: any) => {
      const result2 = await tx
        .select()
        .from(globalEntityMap)
        .where((t: any) => t.stitchId === routeId);

      expect(result2.length).toBe(1); // Should still be 1 row
      expect(result2[0].destEntityId).toBe("dv2");
      expect(result2[0].destTraceId).toBe(newTraceId);
    });
  }, 30000);
});
