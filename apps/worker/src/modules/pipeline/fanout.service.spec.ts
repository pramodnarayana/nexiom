/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { FanOutService } from "./fanout.service.js";
import { QueueService } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { StorageResolverService } from "@nexiom/engine";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as engine from "@nexiom/engine";

vi.mock("@nexiom/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexiom/engine")>();
  return {
    ...actual,
    evaluateConditions: vi.fn(),
  };
});

describe("FanOutService", () => {
  let service: FanOutService;
  let queueService: any;
  let db: any;
  let storageResolver: any;
  let mockTxInsert: any;

  beforeEach(async () => {
    vi.mocked(engine.evaluateConditions).mockReturnValue(true);

    mockTxInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "outbound_1" }]),
        }),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        returning: vi.fn().mockResolvedValue([{ id: "outbound_1" }]),
        then: (res: any) => Promise.resolve(undefined).then(res),
      }),
    });
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
      select: vi.fn().mockImplementation((args) => {
        if (args && args.appName !== undefined) {
          return Object.assign(
            Promise.resolve([{ appName: "testApp", tenantId: "org_1" }]),
            {
              from: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
            },
          );
        }
        return queryBuilder;
      }),
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
                  sourceId: "src_vendor",
                },
              ]
            : [],
        ),
        insert: mockTxInsert,
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
    db.select.mockImplementation((args: any) => {
      if (args && args.appName !== undefined)
        return Object.assign(
          Promise.resolve([{ appName: "testApp", tenantId: "org_1" }]),
          {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
          },
        );
      return Object.assign(
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
          limit: vi.fn().mockReturnThis(),
        },
      );
    });

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    expect(mockTxInsert).toHaveBeenCalled();
  });

  it("should skip if conditions do not match", async () => {
    vi.mocked(engine.evaluateConditions).mockReturnValue(false);

    db.select.mockImplementation((args: any) => {
      if (args && args.appName !== undefined)
        return Object.assign(
          Promise.resolve([{ appName: "testApp", tenantId: "org_1" }]),
          {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
          },
        );
      return Object.assign(
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
          limit: vi.fn().mockReturnThis(),
        },
      );
    });

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    expect(mockTxInsert).toHaveBeenCalledTimes(1);
  });

  it("should return early if no active stitches are found", async () => {
    db.select.mockImplementation((args: any) => {
      if (args && args.appName !== undefined)
        return Object.assign(
          Promise.resolve([{ appName: "testApp", tenantId: "org_1" }]),
          {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
          },
        );
      return Object.assign(Promise.resolve([]), {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      });
    });

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("should log and throw error if db operation fails", async () => {
    db.select.mockImplementation((args: any) => {
      if (args && args.appName !== undefined)
        return Object.assign(
          Promise.resolve([{ appName: "testApp", tenantId: "org_1" }]),
          {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
          },
        );
      return Object.assign(Promise.reject(new Error("DB connection failed")), {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      });
    });

    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("DB connection failed");
  });

  it("should run hydratePayload when field mappings are found", async () => {
    let selectCallIdx = 0;
    db.select.mockImplementation((args: any) => {
      if (args && args.appName !== undefined)
        return Object.assign(
          Promise.resolve([{ appName: "testApp", tenantId: "org_1" }]),
          {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
          },
        );

      selectCallIdx++;
      if (selectCallIdx === 1) {
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
            limit: vi.fn().mockReturnThis(),
          },
        );
      }
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
    expect(mockTxInsert).toHaveBeenCalled();
  });

  it("should record stitch failure and continue to next stitch if a route fails", async () => {
    db.select.mockImplementation((args: any) => {
      if (args && args.appName !== undefined)
        return Object.assign(
          Promise.resolve([{ appName: "testApp", tenantId: "org_1" }]),
          {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
          },
        );
      return Object.assign(
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
          limit: vi.fn().mockReturnThis(),
        },
      );
    });

    const mockValues = mockTxInsert().values;
    mockTxInsert.mockClear();

    mockTxInsert.mockImplementationOnce(() => {
      throw new Error("Simulated enqueue error");
    });

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });

    // Ensure observable outcomes: a FAIL log is written for the failed stitch,
    // and a SUCCESS log is written for the successful stitch.
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAIL", routeId: "stitch_fail" }),
    );
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS", routeId: "stitch_success" }),
    );
  });

  it("should return gracefully and record failure if source connection record (GEM) is not found", async () => {
    db.select.mockImplementation((args: any) => {
      // Returns empty array for appConnections, but return a valid stitch
      if (args && args.appName !== undefined)
        return Object.assign(Promise.resolve([]), {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
        });
      return Object.assign(
        Promise.resolve([
          { id: "stitch_1", syncCondition: [], mappingRules: [] },
        ]),
        {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
        },
      );
    });
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("Source connection record not found");
  });

  it("should record error if replica record is not found", async () => {
    let limitCalls = 0;
    // We mock tx.select to return empty array for limit() for replica check
    db.transaction.mockImplementation(async (cb: any) => {
      const tx = Object.assign(Promise.resolve([]), {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(() => {
          limitCalls++;
          if (limitCalls === 1)
            return Promise.resolve([{ data: { name: "hi" } }]);
          return Promise.resolve([]);
        }),
        insert: mockTxInsert,
        execute: vi.fn().mockResolvedValue({ rowCount: 0 }),
      });
      return cb(tx);
    });

    db.select.mockImplementation((args: any) => {
      if (args && args.appName !== undefined)
        return Object.assign(
          Promise.resolve([{ appName: "testApp", tenantId: "org_1" }]),
          {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
          },
        );
      return Object.assign(
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
          limit: vi.fn().mockReturnThis(),
        },
      );
    });

    const handler = queueService.consume.mock.calls[0][1];
    // This one actually throws to caller because it is in the root transaction processMessage function
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("Replica record not found");
  });

  it("should destroy module", () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});
