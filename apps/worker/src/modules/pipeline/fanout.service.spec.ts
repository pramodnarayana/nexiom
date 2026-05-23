/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from "@nestjs/testing";
import { FanOutService } from "./fanout.service.js";
import { TargetBuilderService } from "./target-builder.service.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { StorageResolverService } from "@nexiom/engine";
import { DB_MANAGER } from "@nexiom/dbmanager";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as engine from "@nexiom/engine";

vi.mock("@nexiom/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexiom/engine")>();
  return {
    ...actual,
    evaluateConditions: vi.fn(),
  };
});

import { ApplicationLoaderService } from "@nexiom/engine";

describe("FanOutService", () => {
  const createDbSelectMock = (
    stitches: any[],
    mappings: any[],
    logs: any[] = [],
  ) => {
    return (args: any) => {
      const isConnectionQuery = args && Object.keys(args).length > 0;
      let resultData = isConnectionQuery
        ? [
            {
              appName: "testApp",
              tenantId: "org_1",
              metadata: { appProfile: "online" },
            },
          ]
        : stitches;

      const qb: any = {};
      qb.from = vi.fn().mockImplementation((table) => {
        if (
          table &&
          "status" in table &&
          "routeId" in table &&
          !("destConnectionId" in table)
        ) {
          resultData = logs;
        } else if (table && "mappingRules" in table) {
          resultData = mappings;
        } else if (table && "appName" in table) {
          resultData = [
            {
              appName: "testApp",
              tenantId: "org_1",
              metadata: { appProfile: "online" },
            },
          ];
        }
        return qb;
      });
      qb.where = vi.fn().mockReturnValue(qb);
      qb.limit = vi.fn().mockReturnValue(qb);
      qb.then = (resolve: any, reject?: any) =>
        Promise.resolve(resultData).then(resolve, reject);
      return qb;
    };
  };

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
      query: {
        dataSources: {
          findFirst: vi.fn().mockResolvedValue({
            tenantId: "tenant_1",
            appName: "testApp",
            metadata: { appProfile: "online" },
          }),
        },
      },
      select: vi.fn().mockImplementation(
        createDbSelectMock(
          [
            {
              id: "stitch_1",
              syncCondition: [{ field: "name", op: "eq", value: "hi" }],
              mappingRules: [],
            },
          ],
          [
            {
              mappingRules: [{ src: "$.name", dest: "$.fullName" }],
              sourceCanonical: "RAW",
            },
          ],
        ),
      ),
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
    storageResolver = {
      resolveSchemaName: vi.fn().mockResolvedValue("ws_1"),
      resolveStorageProfile: vi
        .fn()
        .mockResolvedValue({ schemaName: "ws_1", tenantId: "tenant_1" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: DB_MANAGER,
          useValue: { getTenantDb: vi.fn().mockResolvedValue(db) },
        },
        FanOutService,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: StorageResolverService, useValue: storageResolver },
        {
          provide: ApplicationLoaderService,
          useValue: { load: vi.fn().mockResolvedValue({}) },
        },
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
    db.select.mockImplementation(
      createDbSelectMock(
        [
          {
            id: "stitch_1",
            syncCondition: [{ field: "name", op: "eq", value: "hi" }],
            mappingRules: [],
          },
        ],
        [
          {
            mappingRules: [{ src: "$.name", dest: "$.fullName" }],
            sourceCanonical: "RAW",
          },
        ],
      ),
    );

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", dataSourceId: "456" });
    expect(queueService.send).toHaveBeenCalledWith(
      QueueName.DeliveryQueue,
      expect.objectContaining({
        traceId: "123",
        srcDataSourceId: "456",
        routeId: "stitch_1",
      }),
    );
    expect(mockTxInsert).toHaveBeenCalled();
  });

  it("should skip if conditions do not match", async () => {
    vi.mocked(engine.evaluateConditions).mockReturnValue(false);
    db.select.mockImplementation(
      createDbSelectMock(
        [
          {
            id: "stitch_2",
            syncCondition: [{ field: "name", op: "eq", value: "bye" }],
            mappingRules: [],
          },
        ],
        [
          {
            mappingRules: [{ src: "$.name", dest: "$.fullName" }],
            sourceCanonical: "RAW",
          },
        ],
      ),
    );

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", dataSourceId: "456" });
    expect(mockTxInsert).toHaveBeenCalledTimes(1);
  });

  it("should return early if no active stitches are found", async () => {
    db.select.mockImplementation(createDbSelectMock([], []));

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", dataSourceId: "456" });
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("should log and throw error if db operation fails", async () => {
    db.select.mockImplementation((args: any) => {
      const qb: any = {};
      const isConnectionQuery = args && Object.keys(args).length > 0;
      qb.from = vi.fn().mockReturnValue(qb);
      qb.where = vi.fn().mockReturnValue(qb);
      qb.limit = vi.fn().mockReturnValue(qb);
      if (isConnectionQuery) {
        qb.then = (res: any, rej: any) =>
          Promise.resolve([
            {
              appName: "testApp",
              tenantId: "org_1",
              metadata: { appProfile: "online" },
            },
          ]).then(res, rej);
      } else {
        qb.then = (res: any, rej: any) =>
          Promise.reject(new Error("DB connection failed")).then(res, rej);
      }
      return qb;
    });

    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", dataSourceId: "456" }),
    ).rejects.toThrow("DB connection failed");
  });

  it("should run hydratePayload when field mappings are found", async () => {
    db.select.mockImplementation(
      createDbSelectMock(
        [
          {
            id: "stitch_1",
            syncCondition: [{ field: "name", op: "eq", value: "hi" }],
            mappingRules: [],
          },
        ],
        [
          {
            mappingRules: [{ src: "$.name", dest: "$.fullName" }],
            sourceCanonical: "RAW",
          },
        ],
      ),
    );

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", dataSourceId: "456" });
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
    db.select.mockImplementation(
      createDbSelectMock(
        [
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
        ],
        [
          {
            mappingRules: [{ src: "$.name", dest: "$.fullName" }],
            sourceCanonical: "RAW",
          },
        ],
      ),
    );

    const mockValues = mockTxInsert().values;
    mockTxInsert.mockClear();

    mockTxInsert.mockImplementationOnce(() => {
      throw new Error("Simulated enqueue error");
    });

    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", dataSourceId: "456" });

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
      const qb: any = {};
      const keyCount = args ? Object.keys(args).length : 0;
      let resultData: any[] = [];
      if (keyCount === 1) {
        resultData = [
          {
            appName: "testApp",
            tenantId: "org_1",
            metadata: { appProfile: "online" },
          },
        ];
      } else if (keyCount === 3) {
        resultData = [];
      } else {
        resultData = [{ id: "stitch_1", syncCondition: [], mappingRules: [] }];
      }
      qb.from = vi.fn().mockReturnValue(qb);
      qb.where = vi.fn().mockReturnValue(qb);
      qb.limit = vi.fn().mockReturnValue(qb);
      qb.then = (res: any, rej: any) =>
        Promise.resolve(resultData).then(res, rej);
      return qb;
    });
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", dataSourceId: "456" }),
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

    db.select.mockImplementation(
      createDbSelectMock(
        [
          {
            id: "stitch_1",
            syncCondition: [{ field: "name", op: "eq", value: "hi" }],
            mappingRules: [],
          },
        ],
        [],
      ),
    );

    const handler = queueService.consume.mock.calls[0][1];
    // This one actually throws to caller because it is in the root transaction processMessage function
    await expect(
      handler({ traceId: "123", dataSourceId: "456" }),
    ).rejects.toThrow("Replica record not found");
  });

  it("should destroy module", () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });

  it("should skip DeliveryQueue publication when upsert returns zero rows", async () => {
    // Configure transaction to simulate zero-row upsert (non-retriable outbound state)
    let txCount = 0;
    db.transaction.mockImplementation(async (cb: any) => {
      txCount++;
      const isFirstTx = txCount === 1; // getReplicaAndStitches

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
          return Promise.resolve([]);
        }),
        insert: mockTxInsert,
        execute: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
      });
      return cb(tx);
    });

    db.select.mockImplementation(
      createDbSelectMock(
        [
          {
            id: "stitch_1",
            syncCondition: [],
            mappingRules: [],
          },
        ],
        [
          {
            mappingRules: [{ src: "$.name", dest: "$.fullName" }],
            sourceCanonical: "RAW",
          },
        ],
      ),
    );

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await expect(
      handler({ traceId: "123", dataSourceId: "456" }),
    ).resolves.toBeUndefined();

    // Assert that DeliveryQueue.send was NOT called (zero rows = already processed)
    expect(queueService.send).not.toHaveBeenCalledWith(
      QueueName.DeliveryQueue,
      expect.anything(),
    );
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

    db.select.mockImplementation(
      createDbSelectMock(
        [
          {
            id: "stitch_1",
            syncCondition: [],
            mappingRules: [],
          },
        ],
        [],
      ),
    );

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    // spy on writeSyncLog
    vi.spyOn(service as any, "writeSyncLog").mockResolvedValue(undefined);

    await expect(
      handler({ traceId: "123", dataSourceId: "456" }),
    ).resolves.toBeUndefined();

    expect((service as any).writeSyncLog).toHaveBeenCalledWith(
      "ws_1",
      "123",
      "stitch_1",
      "L4",
      "SKIPPED",
      expect.any(Number),
      expect.anything(),
      expect.anything(),
    );
  });

  it("should release sync lock if no active stitches are processed", async () => {
    // Configure transaction to return replica
    let txCount = 0;
    db.transaction.mockImplementation(async (cb: any) => {
      txCount++;
      const isFirstTx = txCount === 1; // getReplicaAndStitches

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
                entityId: "src_vendor",
              },
            ]);
          }
          return Promise.resolve([]);
        }),
        delete: vi.fn().mockReturnThis(),
        insert: mockTxInsert,
        execute: vi.fn().mockResolvedValue([]),
      });
      return cb(tx);
    });

    db.select.mockImplementation(
      createDbSelectMock(
        [
          {
            id: "stitch_2",
            status: "ARCHIVED",
            syncCondition: [],
            mappingRules: [],
          },
        ],
        [],
      ),
    );

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    vi.spyOn(service as any, "releaseSyncLock");

    await handler({ traceId: "123", dataSourceId: "456" });

    expect((service as any).releaseSyncLock).toHaveBeenCalledWith(
      "ws_1",
      "456",
      "src_vendor",
      expect.anything(),
    );
  });

  it("should handle error when queue publish fails and decrement lock ref count", async () => {
    db.transaction.mockImplementation(async (cb: any) => {
      const tx = Object.assign(Promise.resolve([]), {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(() => {
          return Promise.resolve([
            {
              id: "outbound_1",
              data: { name: "hi" },
              canonicalType: "RAW",
              reqPayload: {},
              entityId: "src_vendor",
            },
          ]);
        }),
        delete: vi.fn().mockReturnThis(),
        insert: mockTxInsert,
        execute: vi.fn().mockResolvedValue([]),
      });
      return cb(tx);
    });

    db.select.mockImplementation(
      createDbSelectMock(
        [
          {
            id: "stitch_2",
            status: "ACTIVE",
            syncCondition: [],
            mappingRules: [],
          },
        ],
        [
          {
            mappingRules: [{ src: "$.name", dest: "$.fullName" }],
            sourceCanonical: "RAW",
          },
        ],
      ),
    );

    queueService.send.mockRejectedValueOnce(new Error("Send failed"));

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    vi.spyOn(service as any, "releaseSyncLock");
    vi.spyOn(service as any, "writeSyncLog").mockResolvedValue(undefined);

    await handler({ traceId: "123", dataSourceId: "456" });

    // Should call writeSyncLog with FAIL
    expect((service as any).writeSyncLog).toHaveBeenCalledWith(
      expect.anything(),
      "123",
      "stitch_2",
      "L4",
      "FAIL",
      expect.any(Number),
      expect.anything(),
      expect.anything(),
    );
    // Should call releaseSyncLock because ref count decremented to 0
    expect((service as any).releaseSyncLock).toHaveBeenCalled();
  });

  it("should load nested SyncToken from destState if gemLink and targetReplica exist", async () => {
    // Configure transaction to return gemLinkage and targetReplica
    let txCount = 0;
    db.transaction.mockImplementation(async (cb: any) => {
      txCount++;
      const isFirstTx = txCount === 1; // getReplicaAndStitches
      const isSecondTx = txCount === 2; // lock check

      let secondTxCall = 0;
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
                entityId: "src_vendor",
              },
            ]);
          }
          if (isSecondTx) {
            secondTxCall++;
            if (secondTxCall === 1) return Promise.resolve([]); // sync lock
            if (secondTxCall === 2)
              return Promise.resolve([{ destEntityId: "ext_123" }]); // gem link
            if (secondTxCall === 3)
              return Promise.resolve([
                { data: { time: "now", Vendor: { SyncToken: "999" } } },
              ]); // target replica
          }
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

    db.select.mockImplementation(() => {
      let resultData: any[] = [];
      const qb: any = {};
      qb.from = vi.fn().mockImplementation((table) => {
        const tableName = table ? table[Symbol.for("drizzle:Name")] : undefined;
        if (
          tableName === "field_mapping" ||
          (table && "mappingRules" in table)
        ) {
          resultData = [
            {
              mappingRules: [{ src: "$.name", dest: "$.fullName" }],
              sourceCanonical: "RAW",
            },
          ];
        } else if (
          tableName === "data_source" ||
          (table && "appName" in table)
        ) {
          resultData = [
            {
              appName: "testApp",
              tenantId: "org_1",
              metadata: { appProfile: "online" },
            },
          ];
        } else if (
          tableName === "global_entity_map" ||
          (table && "destEntityId" in table)
        ) {
          resultData = [{ destEntityId: "ext_123" }]; // globalEntityMap
        } else if (
          tableName === "outbound_gateway" ||
          (table && "data" in table)
        ) {
          resultData = [
            { data: { time: "now", Vendor: { SyncToken: "999" } } },
          ]; // replicaEntity
        } else {
          resultData = [
            { id: "stitch_1", syncCondition: [], mappingRules: [] },
          ]; // stitches
        }
        return qb;
      });
      qb.where = vi.fn().mockReturnValue(qb);
      qb.limit = vi.fn().mockReturnValue(qb);
      qb.then = (resolve: any, reject?: any) =>
        Promise.resolve(resultData).then(resolve, reject);
      return qb;
    });

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    vi.spyOn((service as any).logger, "log");

    await handler({ traceId: "123", dataSourceId: "456" });

    // Assert that the debug log successfully extracted the nested SyncToken "999"
    expect((service as any).logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ syncToken: "999" }),
      expect.stringContaining("SyncToken=999"),
    );
  });
});
