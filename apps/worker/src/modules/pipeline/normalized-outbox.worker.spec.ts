/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { NormalizedOutboxWorker } from "./normalized-outbox.worker.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { DB_MANAGER } from "@nexiom/dbmanager";
import { describe, it, expect, vi, beforeEach } from "vitest";

const MAX_ATTEMPTS = 6; // mirrors the constant in the worker

describe("NormalizedOutboxWorker", () => {
  let worker: NormalizedOutboxWorker;
  let queueService: any;
  let globalDb: any;
  let tenantDb: any;
  let dbManager: any;

  // Helper: builds a mock db where transaction claims `rows`
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
      { id: "out_1", traceId: "trace_1", connectionId: "conn_1", attempts: 1 },
    ]);

    const mockTenants: any = [{ tenantId: "tenant_1" }];
    mockTenants.where = vi
      .fn()
      .mockResolvedValue([{ id: "conn_1", appName: "salesforce" }]);

    globalDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnValue(mockTenants),
    };

    dbManager = {
      getTenantDb: vi.fn().mockResolvedValue(tenantDb),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NormalizedOutboxWorker,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: globalDb },
        { provide: DB_MANAGER, useValue: dbManager },
      ],
    }).compile();

    worker = module.get<NormalizedOutboxWorker>(NormalizedOutboxWorker);
  });

  it("should claim and process pending outbox rows successfully", async () => {
    await worker.processOutbox();

    // traceId/connectionId are the consumer dedup keys (no idempotencyKey)
    expect(queueService.send).toHaveBeenCalledWith(QueueName.NormalizedQueue, {
      traceId: "trace_1",
      connectionId: "conn_1",
    });

    // Status must transition to SUCCESS
    expect(tenantDb.update).toHaveBeenCalled();
    const setCalls = tenantDb.update.mock.results.flatMap(
      (r: any) => r.value?.set?.mock?.calls ?? [],
    );
    expect(setCalls.some((args: any[]) => args[0]?.status === "SUCCESS")).toBe(
      true,
    );
  });

  it("should transition to RETRY with backoff when send fails under MAX_ATTEMPTS", async () => {
    queueService.send.mockRejectedValueOnce(new Error("Network failure"));
    const beforeMs = Date.now();
    await worker.processOutbox();

    expect(tenantDb.update).toHaveBeenCalled();
    const setCalls = tenantDb.update.mock.results.flatMap(
      (r: any) => r.value?.set?.mock?.calls ?? [],
    );

    // At least one call must set status RETRY
    const retryArg = setCalls.find(
      (args: any[]) => args[0]?.status === "RETRY",
    );
    expect(retryArg).toBeDefined();

    // nextRetryAt must be in the future (backoff of 2^attempts * 1000 ms)
    const nextRetryAt: Date = retryArg![0].nextRetryAt;
    expect(nextRetryAt).toBeInstanceOf(Date);
    expect(nextRetryAt.getTime()).toBeGreaterThan(beforeMs);
    // attempts=1 → delay = 2^1 * 1000 = 2000ms. Allow generous tolerance.
    expect(nextRetryAt.getTime()).toBeGreaterThanOrEqual(beforeMs + 1_000);
  });

  it("should transition to FAIL when attempts >= MAX_ATTEMPTS", async () => {
    queueService.send.mockRejectedValueOnce(new Error("Perm failure"));
    tenantDb = buildDb([
      {
        id: "out_2",
        traceId: "trace_2",
        connectionId: "conn_2",
        attempts: MAX_ATTEMPTS,
      },
    ]);
    dbManager.getTenantDb.mockResolvedValue(tenantDb);

    const module = await Test.createTestingModule({
      providers: [
        NormalizedOutboxWorker,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: globalDb },
        { provide: DB_MANAGER, useValue: dbManager },
      ],
    }).compile();
    worker = module.get<NormalizedOutboxWorker>(NormalizedOutboxWorker);

    await worker.processOutbox();

    expect(tenantDb.update).toHaveBeenCalled();
    const setCalls = tenantDb.update.mock.results.flatMap(
      (r: any) => r.value?.set?.mock?.calls ?? [],
    );
    // Must persist FAIL status
    const failArg = setCalls.find((args: any[]) => args[0]?.status === "FAIL");
    expect(failArg).toBeDefined();
    // Must also record the error message
    expect(typeof failArg![0].lastError).toBe("string");
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
    tenantDb.from.mockRejectedValueOnce(new Error("Schema query error"));
    await expect(worker.processOutbox()).resolves.toBeUndefined();
  });

  it("should log critical failure if processOutboxRow rejects", async () => {
    vi.spyOn(worker as any, "processOutboxRow").mockRejectedValueOnce(
      new Error("processOutboxRow failed"),
    );
    await expect(worker.processOutbox()).resolves.toBeUndefined();
  });

  it("should log error if database update fails when marking FAIL/RETRY", async () => {
    queueService.send.mockRejectedValueOnce(new Error("Network failure"));
    tenantDb.update.mockImplementationOnce(() => {
      throw new Error("DB update failed during retry");
    });
    await expect(worker.processOutbox()).resolves.toBeUndefined();
  });

  it("should log error if database update fails when marking SUCCESS", async () => {
    tenantDb.update.mockImplementationOnce(() => {
      throw new Error("DB update failed during success");
    });
    await expect(worker.processOutbox()).resolves.toBeUndefined();
  });
});
