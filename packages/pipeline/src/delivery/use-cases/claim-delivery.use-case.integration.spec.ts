import { StorageResolverService } from "../../storage-resolver/storage-resolver.service.js";
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from "@nestjs/testing";
import { ClaimDeliveryUseCase } from "./claim-delivery.use-case.js";
import { DATABASE_CONNECTION, TestDatabaseManager, dataSources } from "@soopa/database";
import { DB_MANAGER, SchemaPlan } from "@soopa/dbmanager";
import { DeliveryRetryService } from "../delivery-retry.service.js";
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { MAX_DELIVERY_ATTEMPTS } from "../delivery.service.js";
import { sql } from "drizzle-orm";

describe("ClaimDeliveryUseCase", () => {
  let useCase: ClaimDeliveryUseCase;
  let storageResolver: any;
  let testDbManager: TestDatabaseManager;
  let outboundGatewayPort: any;
  let retryService: any;
  let connectionPort: any;
  
  const TENANT_ID = crypto.randomUUID();
  const TARGET_CONNECTION_ID = crypto.randomUUID();
  const DATA_SOURCE_ID = crypto.randomUUID();
  const TRACE_ID = crypto.randomUUID();
  const ROUTE_ID = crypto.randomUUID();
  const SCHEMA_NAME = "ws_schema";

  const mockInput: any = {
    traceId: TRACE_ID,
    dataSourceId: DATA_SOURCE_ID,
    targetConnectionId: TARGET_CONNECTION_ID,
    routeId: ROUTE_ID,
    hydratedPayload: { data: 1 },
    canonicalType: "Contact",
    srcAppName: "App",
    srcOrganizationId: TENANT_ID,
    start: Date.now(),
    writeL6ResultFn: vi.fn().mockResolvedValue(true),
  };

  beforeAll(async () => {
    testDbManager = new TestDatabaseManager();
    await testDbManager.start();

    // Setup global and tenant schema
    await testDbManager.createSchema(SCHEMA_NAME);
    await testDbManager.db!.execute(sql.raw(`SET search_path TO "${SCHEMA_NAME}"`));
    await testDbManager.db!.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS data_source (
        id uuid PRIMARY KEY,
        tenant_id text NOT NULL,
        app_name varchar(100) NOT NULL,
        external_id varchar(255) NOT NULL,
        display_name varchar(255) NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}',
        schema_plan varchar(64) NOT NULL DEFAULT 'NAMESPACE_ONLY',
        sync_interval_minutes integer NOT NULL DEFAULT 30,
        schedule_enabled boolean NOT NULL DEFAULT true,
        env_type text NOT NULL DEFAULT 'PRODUCTION',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        organization_id varchar(255),
        schema_name varchar(100),
        last_scheduled_at timestamptz
      )
    `));
    await testDbManager.db!.execute(sql.raw(`SET search_path TO public`));
    
    // Insert global dataSources record
    await testDbManager.db!.insert(dataSources).values({
      id: TARGET_CONNECTION_ID,
      tenantId: TENANT_ID,
      appName: "App2",
      externalId: "ext1",
      displayName: "Display App",
      metadata: {},
    });

    // Insert tenant dataSources record
    await testDbManager.db!.transaction(async (tx: any) => {
      await tx.execute(sql.raw(`SET LOCAL search_path TO "${SCHEMA_NAME}"`));
      await tx.insert(dataSources).values({
        id: TARGET_CONNECTION_ID,
        tenantId: TENANT_ID,
        appName: "App2",
        externalId: "ext1",
        displayName: "Display App",
        metadata: {},
      });
    });
  }, 60000);

  afterAll(async () => {
    await testDbManager.stop();
  });

  beforeEach(async () => {
    mockInput.writeL6ResultFn.mockClear();
    
    storageResolver = {
      resolveSchemaName: vi.fn().mockResolvedValue(SCHEMA_NAME),
    };

    connectionPort = {
      getGlobalConnectionMeta: vi.fn().mockImplementation(async (id) => id === TARGET_CONNECTION_ID ? { tenantId: TENANT_ID } : null),
      getTenantConnectionMeta: vi.fn().mockResolvedValue({ appName: "App2", tenantId: TENANT_ID }),
    };

    outboundGatewayPort = {
      insertOrFetchPending: vi.fn().mockResolvedValue({
        id: "gw1",
        attempts: 1,
        status: "PENDING",
      }),
      claimForProcessing: vi
        .fn()
        .mockResolvedValue({ claimed: true, attemptCount: 1 }),
    };

    retryService = {
      isSourceFinalized: vi.fn().mockResolvedValue(true),
      retrySourceFinalization: vi.fn().mockResolvedValue(true),
    };

    useCase = new ClaimDeliveryUseCase(
      storageResolver,
      connectionPort,
      outboundGatewayPort,
      retryService
    );
  });

  it("should successfully claim delivery", async () => {
    const result = await useCase.execute(mockInput);
    expect(result.status).toBe("CLAIMED");
    if (result.status === "CLAIMED") {
      expect(result.outboundGatewayId).toBe("gw1");
      expect(result.targetAppName).toBe("App2");
    }
  });

  it("should throw if globalDb connection meta is not found", async () => {
    const missingId = crypto.randomUUID();
    const invalidInput = { ...mockInput, targetConnectionId: missingId };
    await expect(useCase.execute(invalidInput)).rejects.toThrow(
      `Connection ${missingId} not found in global DB`,
    );
  });

  it("should throw if tenant target connection not found", async () => {
    const emptyConnectionPort = {
      ...connectionPort,
      getTenantConnectionMeta: vi.fn().mockResolvedValue(null),
    };

    const useCaseWithEmptyTenant = new ClaimDeliveryUseCase(
      storageResolver,
      emptyConnectionPort,
      outboundGatewayPort,
      retryService
    );

    await expect(useCaseWithEmptyTenant.execute(mockInput)).rejects.toThrow(
      `Target connection ${TARGET_CONNECTION_ID} not found`,
    );
  });

  it("should terminate and fail on max attempts", async () => {
    outboundGatewayPort.insertOrFetchPending.mockResolvedValueOnce({
      id: "gw1",
      attempts: MAX_DELIVERY_ATTEMPTS,
      status: "PENDING",
    });

    const result = await useCase.execute(mockInput);
    expect(result.status).toBe("TERMINATED");
    expect(mockInput.writeL6ResultFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "gw1",
      MAX_DELIVERY_ATTEMPTS,
      DATA_SOURCE_ID,
      TRACE_ID,
      ROUTE_ID,
      null,
      null,
      500,
      "FAIL",
      expect.anything(),
      undefined,
      "Contact",
      "App",
      TENANT_ID,
      undefined,
      TARGET_CONNECTION_ID,
      undefined,
      undefined,
      undefined,
      TENANT_ID
    );
  });

  it("should terminate if already SUCCESS and source finalized", async () => {
    outboundGatewayPort.insertOrFetchPending.mockResolvedValueOnce({
      id: "gw1",
      attempts: 1,
      status: "SUCCESS",
    });
    retryService.isSourceFinalized.mockResolvedValueOnce(true);

    const result = await useCase.execute(mockInput);
    expect(result.status).toBe("TERMINATED");
    expect(retryService.retrySourceFinalization).not.toHaveBeenCalled();
  });

  it("should retry finalization if SUCCESS but source NOT finalized", async () => {
    outboundGatewayPort.insertOrFetchPending.mockResolvedValueOnce({
      id: "gw1",
      attempts: 1,
      status: "SUCCESS",
    });
    retryService.isSourceFinalized.mockResolvedValueOnce(false);
    retryService.retrySourceFinalization.mockResolvedValueOnce(true);

    const result = await useCase.execute(mockInput);
    expect(result.status).toBe("TERMINATED");
    expect(retryService.retrySourceFinalization).toHaveBeenCalled();
  });

  it("should throw if SUCCESS and source finalization retry fails", async () => {
    outboundGatewayPort.insertOrFetchPending.mockResolvedValueOnce({
      id: "gw1",
      attempts: 1,
      status: "SUCCESS",
    });
    retryService.isSourceFinalized.mockResolvedValueOnce(false);
    retryService.retrySourceFinalization.mockResolvedValueOnce(false); // fails

    await expect(useCase.execute(mockInput)).rejects.toThrow(
      "Source-side finalization retry failed",
    );
  });

  it("should terminate if already FAIL and source finalized", async () => {
    outboundGatewayPort.insertOrFetchPending.mockResolvedValueOnce({
      id: "gw1",
      attempts: 1,
      status: "FAIL",
    });
    retryService.isSourceFinalized.mockResolvedValueOnce(true);

    const result = await useCase.execute(mockInput);
    expect(result.status).toBe("TERMINATED");
  });

  it("should retry finalization if FAIL but source NOT finalized", async () => {
    outboundGatewayPort.insertOrFetchPending.mockResolvedValueOnce({
      id: "gw1",
      attempts: 1,
      status: "FAIL",
    });
    retryService.isSourceFinalized.mockResolvedValueOnce(false);
    retryService.retrySourceFinalization.mockResolvedValueOnce(true);

    const result = await useCase.execute(mockInput);
    expect(result.status).toBe("TERMINATED");
    expect(retryService.retrySourceFinalization).toHaveBeenCalled();
  });

  it("should throw if FAIL and source finalization retry fails", async () => {
    outboundGatewayPort.insertOrFetchPending.mockResolvedValueOnce({
      id: "gw1",
      attempts: 1,
      status: "FAIL",
    });
    retryService.isSourceFinalized.mockResolvedValueOnce(false);
    retryService.retrySourceFinalization.mockResolvedValueOnce(false); // fails

    await expect(useCase.execute(mockInput)).rejects.toThrow(
      "Source-side finalization retry failed",
    );
  });

  it("should terminate if claiming fails", async () => {
    outboundGatewayPort.claimForProcessing.mockResolvedValueOnce({
      claimed: false,
      attemptCount: 0,
    });
    const result = await useCase.execute(mockInput);
    expect(result.status).toBe("TERMINATED");
  });
});
