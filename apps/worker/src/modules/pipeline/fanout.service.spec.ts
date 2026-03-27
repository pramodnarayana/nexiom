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

    const queryBuilder: any = Object.assign(Promise.resolve([]), {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnThis(),
    });

    db = {
      select: vi.fn().mockReturnValue(queryBuilder),
      transaction: vi.fn(),
    };
    let txCount = 0;
    db.transaction.mockImplementation(async (cb: any) => {
      txCount++;
      const isFirstTx = txCount === 1;
      const tx = Object.assign(Promise.resolve([]), {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(
          isFirstTx
            ? [
                {
                  id: "outbound_1",
                  data: { name: "hi" },
                  canonicalType: "RAW",
                  reqPayload: {},
                },
              ]
            : [],
        ),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: "outbound_1" }]),
            }),
            returning: vi.fn().mockResolvedValue([{ id: "outbound_1" }]),
          }),
        }),
        execute: vi.fn().mockResolvedValue({ rowCount: 0 }),
      });
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
    service.onModuleInit();
  });

  it("should fanout properly if stitches are found", async () => {
    // Return stitches using pure vitest mock mechanisms
    const mockQueryBuilder: any = Object.assign(
      Promise.resolve([
        {
          id: "stitch_1",
          syncCondition: [{ field: "name", op: "eq", value: "hi" }],
          mappingRules: [],
        },
      ]),
      {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      },
    );
    db.select.mockReturnValueOnce(mockQueryBuilder);

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    expect(queueService.send).toHaveBeenCalledWith(
      QueueName.DeliveryQueue,
      expect.any(Object),
    );
  });

  it("should skip if conditions do not match", async () => {
    const mockQueryBuilder: any = Object.assign(
      Promise.resolve([
        {
          id: "stitch_2",
          syncCondition: [{ field: "name", op: "eq", value: "bye" }],
          mappingRules: [],
        },
      ]),
      {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      },
    );
    db.select.mockReturnValueOnce(mockQueryBuilder);

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    expect(queueService.send).not.toHaveBeenCalled();
  });

  it("should return early if no active stitches are found", async () => {
    const mockQueryBuilder: any = Object.assign(Promise.resolve([]), {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
    });
    db.select.mockReturnValueOnce(mockQueryBuilder);

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    expect(queueService.send).not.toHaveBeenCalled();
  });

  it("should log and throw error if db operation fails", async () => {
    const mockQueryBuilder: any = Object.assign(
      Promise.reject(new Error("DB connection failed")),
      {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      },
    );
    db.select.mockReturnValueOnce(mockQueryBuilder);

    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("DB connection failed");
  });

  it("should run hydratePayload when field mappings are found", async () => {
    // First db.select call returns stitch; second returns a non-empty mapping
    let selectCallIdx = 0;
    db.select.mockImplementation(() => {
      selectCallIdx++;
      if (selectCallIdx === 1) {
        // stitches
        return Object.assign(
          Promise.resolve([
            {
              id: "stitch_1",
              syncCondition: [{ field: "name", op: "eq", value: "hi" }],
              destConnectionId: "dest",
            },
          ]),
          {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
          },
        );
      }
      // fieldMappings — return a non-empty mapping with one rule
      return Object.assign(
        Promise.resolve([
          {
            mappingRules: [{ src: "$.name", dest: "$.fullName" }],
            sourceCanonical: "RAW",
          },
        ]),
        {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
        },
      );
    });

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    expect(queueService.send).toHaveBeenCalledWith(
      QueueName.DeliveryQueue,
      expect.any(Object),
    );
  });

  it("should record stitch failure and continue to next stitch if a route fails", async () => {
    const mockQueryBuilder: any = Object.assign(
      Promise.resolve([
        {
          id: "stitch_fail",
          syncCondition: [{ field: "name", op: "eq", value: "hi" }],
          mappingRules: [],
        },
        {
          id: "stitch_success",
          syncCondition: [{ field: "name", op: "eq", value: "hi" }],
          mappingRules: [],
        },
      ]),
      {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      },
    );
    db.select.mockReturnValueOnce(mockQueryBuilder);

    queueService.send
      .mockRejectedValueOnce(new Error("Simulated enqueue error"))
      .mockResolvedValueOnce(undefined);

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });

    // Ensure it continued past the error to process the second stitch!
    expect(queueService.send).toHaveBeenCalledTimes(2);
  });

  it("should destroy module", () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});
