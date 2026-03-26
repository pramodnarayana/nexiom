/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { FanOutService } from "./fanout.service.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { StorageResolverService } from "@nexiom/engine";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("FanOutService", () => {
  let service: FanOutService;
  let queueService: any;
  let db: any;
  let storageResolver: any;

  beforeEach(async () => {
    queueService = { consume: vi.fn(), send: vi.fn() };

    const queryBuilder: any = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnThis(),
      then: function (resolve: any) {
        resolve([]);
      },
    };

    db = {
      select: vi.fn().mockReturnValue(queryBuilder),
      transaction: vi.fn(),
    };

    db.transaction.mockImplementation(async (cb: any) => {
      const tx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockReturnThis(),
        then: function (resolve: any) {
          resolve([
            {
              id: "outbound_1",
              data: { name: "hi" },
              canonicalType: "RAW",
              reqPayload: {},
            },
          ]);
        },
        execute: vi.fn(),
      };
      return cb(tx);
    });
    storageResolver = { resolveSchemaName: vi.fn().mockResolvedValue("ws_1") };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FanOutService,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: StorageResolverService, useValue: storageResolver },
      ],
    }).compile();

    service = module.get<FanOutService>(FanOutService);
  });

  it("should fanout properly if stitches are found", async () => {
    // Return stitches
    const queryBuilder = db.select();
    queryBuilder.then = function (resolve: any) {
      resolve([
        {
          id: "stitch_1",
          syncCondition: [{ field: "name", op: "eq", value: "hi" }],
          mappingRules: [],
        },
      ]);
    };
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    expect(queueService.send).toHaveBeenCalledWith(
      QueueName.DeliveryQueue,
      expect.any(Object),
    );
  });

  it("should skip if conditions do not match", async () => {
    // Return stitches
    const queryBuilder = db.select();
    queryBuilder.then = function (resolve: any) {
      resolve([
        {
          id: "stitch_2",
          syncCondition: [{ field: "name", op: "eq", value: "bye" }],
          mappingRules: [],
        },
      ]);
    };
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    expect(queueService.send).not.toHaveBeenCalled();
  });

  it("should return early if no active stitches are found", async () => {
    const queryBuilder = db.select();
    queryBuilder.then = function (resolve: any) {
      resolve([]); // Empty array simulating no stitches
    };
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    expect(queueService.send).not.toHaveBeenCalled();
  });

  it("should log and throw error if db operation fails", async () => {
    const queryBuilder = db.select();
    queryBuilder.then = function (_resolve: any, reject: any) {
      reject(new Error("DB connection failed"));
    };
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("DB connection failed");
  });
});
