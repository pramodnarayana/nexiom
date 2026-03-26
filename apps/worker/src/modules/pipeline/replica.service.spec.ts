/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { ReplicaService } from "./replica.service.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { StorageResolverService } from "@nexiom/engine";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("ReplicaService", () => {
  let service: ReplicaService;
  let queueService: any;
  let db: any;
  let storageResolver: any;

  beforeEach(async () => {
    queueService = { consume: vi.fn(), send: vi.fn() };
    db = {
      transaction: vi.fn().mockImplementation(async (cb) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([
            {
              traceId: "123",
              objectType: "foo",
              extReqId: "bar",
              id: "1",
              payload: {},
            },
          ]),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          onConflictDoUpdate: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{ id: "1" }]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
        };
        return cb(tx);
      }),
    };
    storageResolver = { resolveSchemaName: vi.fn().mockResolvedValue("ws_1") };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReplicaService,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: StorageResolverService, useValue: storageResolver },
      ],
    }).compile();

    service = module.get<ReplicaService>(ReplicaService);
  });

  it("should process message successfully", async () => {
    service.onModuleInit();
    expect(queueService.consume.mock.calls[0][0]).toBe(QueueName.InboundQueue);
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    expect(queueService.send).toHaveBeenCalledWith(
      QueueName.ReplicaQueue,
      expect.any(Object),
    );
  });

  it("should handle errors gracefully and update sync log to FAIL", async () => {
    db.transaction.mockRejectedValueOnce(new Error("db fail"));
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("db fail");
  });

  it("should throw if inbound record not found", async () => {
    db.transaction.mockImplementationOnce(async (cb: any) =>
      cb({
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]), // mock inbound not found
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("Inbound record for traceId 123 not found");
  });
});
