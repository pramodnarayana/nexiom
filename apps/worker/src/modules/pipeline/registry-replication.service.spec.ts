/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from "@nestjs/testing";
import { RegistryReplicationService } from "./registry-replication.service.js";
import { QueueService } from "@soopa/queue";
import { DB_MANAGER } from "@soopa/dbmanager";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("RegistryReplicationService", () => {
  let service: RegistryReplicationService;
  let queueService: any;
  let registryPort: any;
  let dbManager: any;

  beforeEach(async () => {
    queueService = {
      consume: vi.fn(),
    };

    registryPort = {
      fetchGlobalOutboxRecord: vi.fn().mockResolvedValue({
        id: "outbox1",
        tenantId: "tenant1",
        entityType: "APP_CONNECTION",
        action: "UPSERT",
        payload: {
          id: "conn1",
          schemaName: "global_only",
          schemaPlan: "global_only",
          validField: "yes",
          createdAt: "2026-05-14T10:00:00Z",
        },
      }),
      replicateEntity: vi.fn().mockResolvedValue(undefined),
      markGlobalOutboxSuccess: vi.fn().mockResolvedValue(undefined),
    };

    dbManager = {
      getTenantDb: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistryReplicationService,
        { provide: QueueService, useValue: queueService },
        { provide: "IRegistryReplicationPort", useValue: registryPort },
        { provide: DB_MANAGER, useValue: dbManager },
      ],
    }).compile();

    service = module.get<RegistryReplicationService>(
      RegistryReplicationService,
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should initialize queue consumer on module init", () => {
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(
      "registry-replication-queue",
      expect.any(Function),
    );
  });

  it("should warn and return early if rawMsg is missing outboxId", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    // Pass empty message
    await handler({});
    expect(registryPort.fetchGlobalOutboxRecord).not.toHaveBeenCalled();
  });

  it("should process UPSERT for APP_CONNECTION correctly", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await handler({ outboxId: "outbox1" });

    expect(registryPort.fetchGlobalOutboxRecord).toHaveBeenCalledWith(
      "outbox1",
    );
    expect(registryPort.replicateEntity).toHaveBeenCalled();
    expect(registryPort.markGlobalOutboxSuccess).toHaveBeenCalledWith(
      "outbox1",
    );
  });

  it("should process DELETE for INTEGRATION_STITCH correctly", async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValueOnce({
      id: "outbox2",
      tenantId: "tenant1",
      entityType: "INTEGRATION_STITCH",
      action: "DELETE",
      entityId: "stitch1",
    });

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await handler({ outboxId: "outbox2" });

    expect(registryPort.replicateEntity).toHaveBeenCalled();
    expect(registryPort.markGlobalOutboxSuccess).toHaveBeenCalledWith(
      "outbox2",
    );
  });

  it("should process UPSERT for FIELD_MAPPING correctly", async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValueOnce({
      id: "outbox3",
      tenantId: "tenant1",
      entityType: "FIELD_MAPPING",
      action: "UPSERT",
      payload: { id: "map1" },
    });

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await handler({ outboxId: "outbox3" });

    expect(registryPort.replicateEntity).toHaveBeenCalled();
    expect(registryPort.markGlobalOutboxSuccess).toHaveBeenCalledWith(
      "outbox3",
    );
  });

  it("should return early if outbox record not found", async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValueOnce(null);
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await handler({ outboxId: "outbox_missing" });
    expect(registryPort.replicateEntity).not.toHaveBeenCalled();
    expect(registryPort.markGlobalOutboxSuccess).not.toHaveBeenCalled();
  });

  it("should throw error if replication fails", async () => {
    registryPort.replicateEntity.mockRejectedValueOnce(new Error("DB locked"));
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await expect(handler({ outboxId: "outbox1" })).rejects.toThrow("DB locked");
    expect(registryPort.markGlobalOutboxSuccess).not.toHaveBeenCalled();
  });

  it("should throw error for unrecognized action/entityType", async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValueOnce({
      id: "outbox_unknown",
      tenantId: "tenant1",
      entityType: "APP_CONNECTION",
      action: "UNKNOWN",
    });
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await expect(handler({ outboxId: "outbox_unknown" })).rejects.toThrow(
      "Unrecognized registry outbox operation",
    );
  });

  it("should retry on foreign key violation for FIELD_MAPPING", async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValueOnce({
      id: "outbox_fk",
      tenantId: "tenant1",
      entityType: "FIELD_MAPPING",
      action: "UPSERT",
      payload: {},
    });

    registryPort.replicateEntity
      .mockRejectedValueOnce({ code: "23503" })
      .mockResolvedValueOnce(undefined);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await expect(handler({ outboxId: "outbox_fk" })).resolves.not.toThrow();
    expect(registryPort.replicateEntity).toHaveBeenCalledTimes(2);
    expect(registryPort.markGlobalOutboxSuccess).toHaveBeenCalled();
  });

  it("should provision schema on INTEGRATION_STITCH UPSERT", async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValueOnce({
      id: "outbox_stitch",
      tenantId: "tenant1",
      entityType: "INTEGRATION_STITCH",
      action: "UPSERT",
      payload: { srcDataSourceId: "ds1", destDataSourceId: "ds2" },
    });

    registryPort.getStitchDataSources = vi.fn().mockResolvedValue([
      {
        id: "ds1",
        appName: "salesforce",
        metadata: { appProfile: "standard" },
      },
      { id: "ds2", appName: "hubspot", metadata: { appProfile: "default" } },
    ]);

    dbManager.applyPlan = vi.fn().mockResolvedValue(undefined);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await handler({ outboxId: "outbox_stitch" });

    expect(registryPort.getStitchDataSources).toHaveBeenCalledWith(
      "tenant1",
      "ds1",
      "ds2",
    );
    expect(dbManager.applyPlan).toHaveBeenCalledTimes(2);
    expect(registryPort.markGlobalOutboxSuccess).toHaveBeenCalled();
  });

  it("should throw if stitch data sources are missing", async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValueOnce({
      id: "outbox_stitch",
      tenantId: "tenant1",
      entityType: "INTEGRATION_STITCH",
      action: "UPSERT",
      payload: { srcDataSourceId: "ds1", destDataSourceId: "ds2" },
    });

    registryPort.getStitchDataSources = vi
      .fn()
      .mockResolvedValue([{ id: "ds1", appName: "salesforce", metadata: {} }]); // ds2 is missing

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await expect(handler({ outboxId: "outbox_stitch" })).rejects.toThrow(
      "Stitch data sources not yet replicated",
    );
  });
});
