/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { DeliveryOutboxWorker } from "./delivery-outbox.worker.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("DeliveryOutboxWorker", () => {
  let worker: DeliveryOutboxWorker;
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
              payload: { routeId: "123" },
              attempts: 1,
            },
          ]),
        };
        return cb(tx);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryOutboxWorker,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();

    worker = module.get<DeliveryOutboxWorker>(DeliveryOutboxWorker);
  });

  it("should claim and process pending outbox rows successfully", async () => {
    await worker.processOutbox();

    // idempotencyKey is the outbox row id — added by the worker for stable deduplication
    expect(queueService.send).toHaveBeenCalledWith(QueueName.DeliveryQueue, {
      routeId: "123",
      idempotencyKey: "out_1",
    });

    expect(db.update).toHaveBeenCalled();
  });

  it("should delay retry if sending fails but under MAX_ATTEMPTS", async () => {
    queueService.send.mockRejectedValueOnce(new Error("Network failure"));
    await worker.processOutbox();

    expect(db.update).toHaveBeenCalled();
  });

  it("should permanently fail if attempts exceeds MAX_ATTEMPTS", async () => {
    queueService.send.mockRejectedValueOnce(new Error("Perm failure"));
    db.transaction.mockImplementation(async (cb: any) => {
      const tx = {
        execute: vi.fn(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([
          {
            id: "out_2",
            payload: {},
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

  it("should handle exceptions securely", async () => {
    db.transaction.mockRejectedValue(new Error("Fatal Error"));
    await expect(worker.processOutbox()).resolves.toBeUndefined();
  });
});
