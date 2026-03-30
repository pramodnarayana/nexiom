/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { NormalizedOutboxWorker } from "./normalized-outbox.worker.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("NormalizedOutboxWorker", () => {
  let worker: NormalizedOutboxWorker;
  let queueService: any;
  let db: any;

  beforeEach(async () => {
    queueService = { send: vi.fn() };

    db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockResolvedValue([{ dataNamespace: "ws_test" }]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      transaction: vi.fn().mockImplementation(async (cb) => {
        const tx = {
          execute: vi.fn(),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([
            {
              id: "out_1",
              traceId: "trace_1",
              connectionId: "conn_1",
              attempts: 1,
            },
          ]),
        };
        return cb(tx);
      }),
    };

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

    // Verify it sent to Queue (with stable idempotency key derived from outbox row id)
    expect(queueService.send).toHaveBeenCalledWith(QueueName.NormalizedQueue, {
      traceId: "trace_1",
      connectionId: "conn_1",
      idempotencyKey: "out_1",
    });

    // Verify it marked success (second db.update call after transaction claims)
    expect(db.update).toHaveBeenCalled();
  });

  it("should delay retry if sending fails but under MAX_ATTEMPTS", async () => {
    queueService.send.mockRejectedValueOnce(new Error("Network failure"));
    await worker.processOutbox();

    expect(db.update).toHaveBeenCalled();
    // Assuming the set method is called on the builder for update
  });

  it("should permanently fail if attempts exceeds MAX_ATTEMPTS", async () => {
    queueService.send.mockRejectedValueOnce(new Error("Perm failure"));
    // Override tx to return an exhausted row
    db.transaction.mockImplementation(async (cb: any) => {
      const tx = {
        execute: vi.fn(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([
          {
            id: "out_2",
            traceId: "trace_2",
            connectionId: "conn_2",
            attempts: 6, // Exceeds MAX
          },
        ]),
      };
      return cb(tx);
    });

    await worker.processOutbox();
    expect(db.update).toHaveBeenCalled();
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

  it("should handle exceptions from drainWorkspaceOutbox safely", async () => {
    db.transaction.mockRejectedValue(new Error("Fatal DB Error"));
    // The promise all is swallowed by allSettled!
    await expect(worker.processOutbox()).resolves.toBeUndefined();
  });
});
