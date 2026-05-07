/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { FanOutService } from "./fanout.service.js";
import { TargetBuilderService } from "./target-builder.service.js";
import { QueueService, QueueName } from "@nexiom/queue";
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
        then: (onfulfilled?: ((value: any) => any) | null) =>
          Promise.resolve(undefined as any).then(onfulfilled),
      }),
    });
    queueService = { consume: vi.fn(), send: vi.fn() };

    db = {
      select: vi.fn().mockImplementation((args) => {
        // We will return a fresh query builder for each select call so we can inspect from()
        const qb: any = Object.assign(Promise.resolve([]), {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockImplementation((table) => {
            // appConnections
            if (args && args.appName !== undefined) {
              return Object.assign(
                Promise.resolve([{ appName: "testApp", tenantId: "org_1" }]),
                {
                  where: vi.fn().mockReturnThis(),
                  limit: vi.fn().mockReturnThis(),
                },
              );
            }

            // syncLog
            if (
              table &&
              "status" in table &&
              "routeId" in table &&
              !("destConnectionId" in table)
            ) {
              return Object.assign(Promise.resolve([]), {
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
              });
            }

            // fieldMapping
            if (table && "mappingRules" in table) {
              return Object.assign(
                Promise.resolve([
                  {
                    mappingRules: [{ src: "$.name", dest: "$.fullName" }],
                    sourceCanonical: "RAW",
                  },
                ]),
                {
                  where: vi.fn().mockReturnThis(),
                  limit: vi.fn().mockReturnThis(),
                },
              );
            }

            // Default return for stitches, mappings, gem
            return Object.assign(
              Promise.resolve([
                {
                  id: "stitch_1",
                  syncCondition: [{ field: "name", op: "eq", value: "hi" }],
                  mappingRules: [],
                  sourceCanonical: "RAW",
                },
              ]),
              {
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
              },
            );
          }),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          returning: vi.fn().mockReturnThis(),
        });
        return qb;
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
        execute: vi.fn().mockResolvedValue({
          rowCount: 1,
          rows: [{ status: "PENDING", was_insert: true }],
        }),
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
        {
          provide: TargetBuilderService,
          useValue: {
            // Returns normalizedData enriched with mapped fields if rules are passed
            buildPayload: vi
              .fn()
              .mockImplementation(
                (
                  _schema: unknown,
                  _app: unknown,
                  _profile: unknown,
                  _type: unknown,
                  _id: unknown,
                  normalizedData: unknown,
                  rules: unknown,
                ) => {
                  const data = normalizedData as Record<string, unknown>;
                  const ruleArray = rules as Array<{
                    src: string;
                    dest: string;
                  }>;
                  // If rules are provided, inject a hydrated field to verify mapping was applied
                  if (ruleArray && ruleArray.length > 0) {
                    return Promise.resolve({ ...data, _hydrated: true });
                  }
                  return Promise.resolve(data);
                },
              ),
          },
        },
      ],
    }).compile();

    service = module.get<FanOutService>(FanOutService);
    service.onModuleInit();
  });

  it("should fanout properly if stitches are found", async () => {
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    expect(queueService.send).toHaveBeenCalledWith(
      QueueName.DeliveryQueue,
      expect.objectContaining({
        traceId: "123",
        srcConnectionId: "456",
        routeId: "stitch_1",
      }),
    );
  });

  it("should skip if conditions do not match", async () => {
    vi.mocked(engine.evaluateConditions).mockReturnValueOnce(false);

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
    db.select.mockImplementation((args: any) => {
      const qb: any = Object.assign(Promise.resolve([]), {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockImplementation((table: any) => {
          if (args && args.appName !== undefined) {
            return Object.assign(
              Promise.resolve([{ appName: "testApp", tenantId: "org_1" }]),
              {
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
              },
            );
          }

          // syncLog
          if (
            table &&
            "status" in table &&
            "routeId" in table &&
            !("destConnectionId" in table)
          ) {
            return Object.assign(Promise.resolve([]), {
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
            });
          }

          if (table && "mappingRules" in table) {
            return Object.assign(
              Promise.resolve([
                {
                  mappingRules: [{ src: "$.name", dest: "$.fullName" }],
                  sourceCanonical: "RAW",
                },
              ]),
              {
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
              },
            );
          }

          return Object.assign(
            Promise.resolve([
              {
                id: "stitch_1",
                syncCondition: [{ field: "name", op: "eq", value: "hi" }],
                destConnectionId: "dest",
              },
            ]),
            {
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
            },
          );
        }),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      });
      return qb;
    });

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    expect(queueService.send).toHaveBeenCalledWith(
      QueueName.DeliveryQueue,
      expect.objectContaining({
        traceId: "123",
        routeId: "stitch_1",
        hydratedPayload: expect.objectContaining({ _hydrated: true }),
      }),
    );
    expect(mockTxInsert).toHaveBeenCalled();
  });

  it("should record stitch failure and continue to next stitch if a route fails", async () => {
    db.select.mockImplementation((args: any) => {
      const qb: any = Object.assign(Promise.resolve([]), {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockImplementation((table: any) => {
          if (args && args.appName !== undefined) {
            return Object.assign(
              Promise.resolve([{ appName: "testApp", tenantId: "org_1" }]),
              {
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
              },
            );
          }

          // syncLog
          if (
            table &&
            "status" in table &&
            "routeId" in table &&
            !("destConnectionId" in table)
          ) {
            return Object.assign(Promise.resolve([]), {
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
            });
          }

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
              where: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
            },
          );
        }),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      });
      return qb;
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
        execute: vi.fn().mockResolvedValue({
          rowCount: 1,
          rows: [{ status: "PENDING", was_insert: true }],
        }),
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

  it("should skip route and release lock if no mapping rules found", async () => {
    // Configure db.transaction to return a replica but NO field mappings
    let txCount = 0;
    db.transaction.mockImplementation(async (cb: any) => {
      txCount++;
      const isFirstTx = txCount === 1; // getReplicaAndStitches
      const isSecondTx = txCount === 2; // lock check

      const tx = Object.assign(Promise.resolve([]), {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(() => {
          if (isFirstTx) {
            return Promise.resolve([
              {
                id: "outbound_1",
                data: { name: "hi" },
                canonicalType: "RAW",
                reqPayload: {},
                sourceId: "src_vendor",
              },
            ]);
          }
          if (isSecondTx) {
            return Promise.resolve([]); // NO sync locks
          }
          // The next select is for field_mapping rules
          return Promise.resolve([]); // RETURN EMPTY MAPPINGS
        }),
        insert: mockTxInsert,
        execute: vi.fn().mockResolvedValue({
          rowCount: 1,
          rows: [{ status: "PENDING", was_insert: true }],
        }),
      });
      return cb(tx);
    });

    let dbSelectCount = 0;
    db.select.mockImplementation(() => {
      dbSelectCount++;
      // Call 1: integrationStitches
      if (dbSelectCount === 1) {
        return Object.assign(
          Promise.resolve([
            {
              id: "stitch_1",
              syncCondition: [],
              mappingRules: [],
            },
          ]),
          {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
          },
        );
      }
      // Call 2: appConnections
      if (dbSelectCount === 2) {
        return Object.assign(
          Promise.resolve([
            {
              appName: "testApp",
              tenantId: "org_1",
              metadata: { appProfile: "" },
            },
          ]),
          {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
          },
        );
      }
      // Call 3: fieldMappings
      return Object.assign(Promise.resolve([]), {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      });
    });

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    // spy on writeSyncLog
    vi.spyOn(service as any, "writeSyncLog").mockResolvedValue(undefined);

    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).resolves.toBeUndefined();

    expect((service as any).writeSyncLog).toHaveBeenCalledWith(
      "ws_1",
      "123",
      "stitch_1",
      "L4",
      "SKIPPED",
      expect.any(Number),
      expect.anything(),
    );
  });
});
