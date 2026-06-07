/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { NormalizedOutboxPoller } from "./normalized-outbox.poller.js";
import { QueueService, QueueName } from "@soopa/queue";
import { DATABASE_CONNECTION } from "@soopa/database";
import { DB_MANAGER } from "@soopa/dbmanager";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("NormalizedOutboxPoller", () => {
  let worker: NormalizedOutboxPoller;
  let queueService: any;
  let globalDb: any;
  let tenantDb: any;
  let dbManager: any;
  let module: TestingModule;

  function buildDb(rows: any[]) {
    const mockSet = vi.fn().mockReturnThis();
    const mockWhere = vi.fn().mockReturnThis();
    const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhere });

    return {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockResolvedValue([{ dataNamespace: "ws_test" }]),
      update: mockUpdate,
      set: mockSet,
      transaction: vi.fn().mockImplementation(async (cb: any) => {
        const tx = {
          execute: vi.fn(),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue(rows),
        };
        return cb(tx);
      }),
    };
  }

  beforeEach(async () => {
    queueService = { send: vi.fn() };
    tenantDb = buildDb([
      { id: "out_1", traceId: "trace_1", dataSourceId: "conn_1", attempts: 1 },
    ]);

    const mockTenants: any = [{ tenantId: "tenant_1" }];
    mockTenants.innerJoin = vi.fn().mockReturnThis();
    mockTenants.where = vi
      .fn()
      .mockResolvedValue([
        { id: "conn_1", appName: "salesforce", tenantId: "tenant_1" },
      ]);

    globalDb = {
      select: vi.fn().mockReturnThis(),
      selectDistinct: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnValue(mockTenants),
    };

    dbManager = {
      getTenantDb: vi.fn().mockResolvedValue(tenantDb),
    };

    module = await Test.createTestingModule({
      providers: [
        NormalizedOutboxPoller,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: globalDb },
        { provide: DB_MANAGER, useValue: dbManager },
      ],
    }).compile();

    worker = module.get<NormalizedOutboxPoller>(NormalizedOutboxPoller);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  it("should claim and process pending outbox rows successfully", async () => {
    await worker.processOutbox();

    expect(queueService.send).toHaveBeenCalledWith(QueueName.NormalizedQueue, {
      traceId: "trace_1",
      dataSourceId: "conn_1",
    });

    expect(tenantDb.update).toHaveBeenCalled();
  });

  it("should do nothing if no rows are claimed", async () => {
    tenantDb.transaction.mockImplementation(async (cb: any) => {
      const tx = {
        execute: vi.fn(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };
      return cb(tx);
    });
    await worker.processOutbox();
    expect(queueService.send).not.toHaveBeenCalled();
  });

  it("should handle exceptions from drainWorkspaceOutbox safely without throwing", async () => {
    tenantDb.transaction.mockRejectedValue(new Error("Fatal DB Error"));
    await expect(worker.processOutbox()).resolves.toBeUndefined();
  });

  it("should do nothing if no tenants are returned", async () => {
    globalDb.from.mockResolvedValueOnce([]);
    await worker.processOutbox();
    expect(dbManager.getTenantDb).not.toHaveBeenCalled();
  });

  it("should handle global DB query errors securely without throwing", async () => {
    globalDb.from.mockRejectedValueOnce(new Error("Global DB error"));
    await expect(worker.processOutbox()).resolves.toBeUndefined();
  });

  it("should handle TenantDatabaseManager connection errors securely without throwing", async () => {
    dbManager.getTenantDb.mockRejectedValueOnce(new Error("Connection error"));
    await expect(worker.processOutbox()).resolves.toBeUndefined();
  });

  it("should handle schema query errors securely without throwing", async () => {
    globalDb.from.mockReturnValueOnce({
      where: vi.fn().mockRejectedValueOnce(new Error("Schema query error")),
    });
    await expect(worker.processOutbox()).resolves.toBeUndefined();
  });

  it("should log unexpected failures when deliverRow rejects", async () => {
    const loggerErrorSpy = vi.spyOn((worker as any).logger, "error");
    vi.spyOn(worker as any, "deliverRow").mockRejectedValueOnce(
      new Error("Delivery rejected"),
    );

    await worker.processOutbox();

    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(
      loggerErrorSpy.mock.calls.some(
        (call: any[]) =>
          typeof call[0] === "string" &&
          call[0].includes("processOutboxRow critically failed for row"),
      ),
    ).toBe(true);
  });

  it("should catch and log tenant processing errors", async () => {
    dbManager.getTenantDb.mockRejectedValueOnce(new Error("tenant db down"));
    const loggerErrorSpy = vi.spyOn((worker as any).logger, "error");
    await worker.processOutbox();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to process normalized outbox for tenant"),
    );
  });

  it("should return early if tenants is empty", async () => {
    globalDb.from.mockResolvedValueOnce([]);
    await worker.processOutbox();
    expect(queueService.send).not.toHaveBeenCalled();
  });

  it("should return early if allConnections is empty", async () => {
    globalDb.selectDistinct.mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    });
    vi.spyOn((worker as any).logger, "debug");
    await worker.processOutbox();
    expect(queueService.send).not.toHaveBeenCalled();
  });

  it("should return early if tenant has no connections", async () => {
    globalDb.select.mockReturnValueOnce({
      from: () => ({
        where: () => Promise.resolve([{ tenantId: "tenant-2" }]), // tenant-2
      }),
    });
    globalDb.selectDistinct.mockReturnValueOnce({
      from: () => ({
        where: () =>
          Promise.resolve([
            { tenantId: "tenant-1", id: "c1", appName: "app1" },
          ]), // connections only for tenant-1
      }),
    });
    await worker.processOutbox();
    // processOutbox should fetch tenant-2, but it has no connections in connectionsByTenant
    // so it should return early from the chunk processing
    expect(queueService.send).not.toHaveBeenCalled();
  });
});
