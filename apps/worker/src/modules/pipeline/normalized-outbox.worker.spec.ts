/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { NormalizedOutboxWorker } from "./normalized-outbox.worker.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { describe, it, expect, vi, beforeEach } from "vitest";

const MAX_ATTEMPTS = 6; // mirrors the constant in the worker

describe("NormalizedOutboxWorker", () => {
  let worker: NormalizedOutboxWorker;
  let queueService: any;
  let db: any;

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
    db = buildDb([
      { id: "out_1", traceId: "trace_1", connectionId: "conn_1", attempts: 1 },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NormalizedOutboxWorker,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: db },
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
    expect(db.update).toHaveBeenCalled();
    const setCalls = db.update.mock.results.flatMap(
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

    expect(db.update).toHaveBeenCalled();
    const setCalls = db.update.mock.results.flatMap(
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
    db = buildDb([
      {
        id: "out_2",
        traceId: "trace_2",
        connectionId: "conn_2",
        attempts: MAX_ATTEMPTS,
      },
    ]);
    const module = await Test.createTestingModule({
      providers: [
        NormalizedOutboxWorker,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();
    worker = module.get<NormalizedOutboxWorker>(NormalizedOutboxWorker);

    await worker.processOutbox();

    expect(db.update).toHaveBeenCalled();
    const setCalls = db.update.mock.results.flatMap(
      (r: any) => r.value?.set?.mock?.calls ?? [],
    );
    // Must persist FAIL status
    const failArg = setCalls.find((args: any[]) => args[0]?.status === "FAIL");
    expect(failArg).toBeDefined();
    // Must also record the error message
    expect(typeof failArg![0].lastError).toBe("string");
  });

  it("should do nothing if no rows are claimed", async () => {
    db.transaction.mockImplementation(async (cb: any) => {
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
    db.transaction.mockRejectedValue(new Error("Fatal DB Error"));
    await expect(worker.processOutbox()).resolves.toBeUndefined();
  });
});
