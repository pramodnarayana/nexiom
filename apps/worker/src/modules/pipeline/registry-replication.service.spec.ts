/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from "@nestjs/testing";
import { RegistryReplicationService } from "./registry-replication.service.js";
import { QueueService } from "@soopa/queue";
import { DATABASE_CONNECTION } from "@soopa/database";
import { DB_MANAGER } from "@soopa/dbmanager";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("RegistryReplicationService", () => {
  let service: RegistryReplicationService;
  let queueService: any;
  let globalDb: any;
  let tenantDb: any;
  let dbManager: any;

  beforeEach(async () => {
    queueService = {
      consume: vi.fn(),
    };

    globalDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
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
        },
      ]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    const mockTx = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
    };

    tenantDb = {
      transaction: vi
        .fn()
        .mockImplementation(
          async (cb: (tx: any) => Promise<void>) => await cb(mockTx),
        ),
    };

    dbManager = {
      getTenantDb: vi.fn().mockResolvedValue(tenantDb),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistryReplicationService,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: globalDb },
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
      "registry-replication-queue", // QueueName.RegistryReplicationQueue
      expect.any(Function),
    );
  });

  it("should warn and return early if rawMsg is missing outboxId", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    // Pass empty message
    await handler({});
    expect(globalDb.select).not.toHaveBeenCalled();
  });

  it("should process UPSERT for APP_CONNECTION correctly", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await handler({ outboxId: "outbox1" });

    expect(globalDb.select).toHaveBeenCalled();
    expect(dbManager.getTenantDb).toHaveBeenCalledWith("tenant1");
    expect(tenantDb.transaction).toHaveBeenCalled();

    // Check that update was called to mark SUCCESS
    expect(globalDb.update).toHaveBeenCalled();
  });

  it("should process DELETE for INTEGRATION_STITCH correctly", async () => {
    globalDb.limit.mockResolvedValueOnce([
      {
        id: "outbox2",
        tenantId: "tenant1",
        entityType: "INTEGRATION_STITCH",
        action: "DELETE",
        entityId: "stitch1",
      },
    ]);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await handler({ outboxId: "outbox2" });

    expect(tenantDb.transaction).toHaveBeenCalled();
    expect(globalDb.update).toHaveBeenCalled();
  });

  it("should process UPSERT for FIELD_MAPPING correctly", async () => {
    globalDb.limit.mockResolvedValueOnce([
      {
        id: "outbox3",
        tenantId: "tenant1",
        entityType: "FIELD_MAPPING",
        action: "UPSERT",
        payload: { id: "map1" },
      },
    ]);

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await handler({ outboxId: "outbox3" });

    expect(tenantDb.transaction).toHaveBeenCalled();
    expect(globalDb.update).toHaveBeenCalled();
  });

  it("should return early if outbox record not found", async () => {
    globalDb.limit.mockResolvedValueOnce([]);
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await handler({ outboxId: "outbox_missing" });
    expect(dbManager.getTenantDb).not.toHaveBeenCalled();
  });

  it("should throw error if replication fails", async () => {
    tenantDb.transaction.mockRejectedValueOnce(new Error("DB locked"));
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await expect(handler({ outboxId: "outbox1" })).rejects.toThrow("DB locked");
    expect(globalDb.update).not.toHaveBeenCalled(); // Should not mark SUCCESS
  });
});
