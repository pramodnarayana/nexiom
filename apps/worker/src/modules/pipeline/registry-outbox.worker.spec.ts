/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from "@nestjs/testing";
import { RegistryOutboxWorker } from "./registry-outbox.worker.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("RegistryOutboxWorker", () => {
  let worker: RegistryOutboxWorker;
  let queueService: any;
  let globalDb: any;

  beforeEach(async () => {
    queueService = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    globalDb = {
      transaction: vi
        .fn()
        .mockImplementation(async (cb: (tx: any) => Promise<void>) => {
          const tx = {
            update: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue([
              { id: "o1", attempts: 1 },
              { id: "o2", attempts: 2 },
            ]),
          };
          return await cb(tx);
        }),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistryOutboxWorker,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: globalDb },
      ],
    }).compile();

    worker = module.get<RegistryOutboxWorker>(RegistryOutboxWorker);
  });

  it("should be defined", () => {
    expect(worker).toBeDefined();
  });

  it("should return early if no rows are claimed", async () => {
    globalDb.transaction.mockImplementationOnce(
      async (cb: (tx: any) => Promise<unknown>) => {
        return await cb({
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([]),
        });
      },
    );

    await worker.processOutbox();
    expect(queueService.send).not.toHaveBeenCalled();
  });

  it("should process claimed rows and send to queue", async () => {
    await worker.processOutbox();
    expect(queueService.send).toHaveBeenCalledTimes(2);
    expect(queueService.send).toHaveBeenNthCalledWith(
      1,
      QueueName.RegistryReplicationQueue,
      { outboxId: "o1" },
    );
    expect(queueService.send).toHaveBeenNthCalledWith(
      2,
      QueueName.RegistryReplicationQueue,
      { outboxId: "o2" },
    );
  });

  it("should handle queue send error and update status to PENDING with delay", async () => {
    queueService.send.mockRejectedValueOnce(new Error("Queue error"));
    const setMock = vi.fn().mockReturnThis();
    globalDb.update.mockReturnValue({ set: setMock });
    setMock.mockReturnValue({ where: vi.fn() });

    await worker.processOutbox();

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PENDING",
        lastError: "Queue error",
        nextRetryAt: expect.any(Date),
      }),
    );
  });

  it("should mark as FAILED when attempts exceed MAX_ATTEMPTS", async () => {
    globalDb.transaction.mockImplementationOnce(
      async (cb: (tx: any) => Promise<unknown>) => {
        return await cb({
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([
            { id: "o1", attempts: 6 }, // MAX_ATTEMPTS = 6
          ]),
        });
      },
    );
    queueService.send.mockRejectedValueOnce(new Error("Permanent failure"));

    const setMock = vi.fn().mockReturnThis();
    globalDb.update.mockReturnValue({ set: setMock });
    setMock.mockReturnValue({ where: vi.fn() });

    await worker.processOutbox();

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILED",
        lastError: "Permanent failure",
      }),
    );
  });

  it("should catch and log global transaction errors", async () => {
    globalDb.transaction.mockRejectedValueOnce(
      new Error("DB Connection Error"),
    );
    await expect(worker.processOutbox()).resolves.toBeUndefined();
  });
});
