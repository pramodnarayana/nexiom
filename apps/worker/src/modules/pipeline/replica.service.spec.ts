/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from "@nestjs/testing";
import { ReplicaService } from "./replica.service.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import {
  StorageResolverService,
  PipelineHookBrokerService,
} from "@nexiom/engine";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("ReplicaService", () => {
  let service: ReplicaService;
  let queueService: any;
  let db: any;
  let storageResolver: any;
  let hookBroker: { extractReplica: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    queueService = {
      consume: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
    };
    // Default happy-path extractor
    hookBroker = {
      extractReplica: vi.fn().mockResolvedValue({
        entityType: "sf_Account",
        entityId: "mock-entity-id",
        data: {},
      }),
    };
    db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue([
          { appName: "salesforce", metadata: { appProfile: "revenova" } },
        ]),
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
              status: "RECEIVED",
              request: {},
            },
          ]),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          onConflictDoUpdate: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{ id: "1" }]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          delete: vi.fn().mockReturnThis(),
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
        { provide: PipelineHookBrokerService, useValue: hookBroker },
      ],
    }).compile();

    service = module.get<ReplicaService>(ReplicaService);
  });

  it("should process message successfully and write to replicaOutbox atomically", async () => {
    // Expose a named spy to track what was inserted inside the transaction
    const capturedInserts: any[] = [];
    db.transaction.mockImplementationOnce(async (cb: any) => {
      const mockInsert = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((vals: any) => {
          capturedInserts.push(vals);
          return {
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: "1" }]),
            }),
            onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
            then: (onfulfilled?: ((value: any) => any) | null) =>
              Promise.resolve(undefined as any).then(onfulfilled),
          };
        }),
      }));
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            traceId: "123",
            objectType: "foo",
            extReqId: "bar",
            id: "1",
            status: "RECEIVED",
            request: {},
          },
        ]),
        insert: mockInsert,
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      };
      return cb(tx);
    });

    service.onModuleInit();
    expect(queueService.consume.mock.calls[0][0]).toBe(QueueName.InboundQueue);
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });

    // Best-effort enqueue to L3 bypasses CDC pooling delay — verify it fired
    expect(queueService.send).toHaveBeenCalledWith(QueueName.ReplicaQueue, {
      traceId: "123",
      connectionId: "456",
    });
    // The main transaction must have run
    expect(db.transaction).toHaveBeenCalledTimes(1);
    // The replicaOutbox insert must have been called with PENDING status
    const outboxInsert = capturedInserts.find(
      (v) =>
        v.status === "PENDING" &&
        v.traceId === "123" &&
        v.connectionId === "456",
    );
    expect(outboxInsert).toBeDefined();
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
        delete: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("Inbound record for traceId 123 not found");
  });

  it("should throw if connection not found in appConnections", async () => {
    db.limit.mockResolvedValueOnce([]); // no appName returned
    db.transaction.mockImplementationOnce(async (cb: any) =>
      cb({
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
            status: "RECEIVED",
            request: {},
          },
        ]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("Connection 456 not found in appConnections!");
  });

  it("should throw if replica extraction fails due to payload shape mismatch", async () => {
    hookBroker.extractReplica.mockResolvedValueOnce(null);
    db.limit.mockResolvedValueOnce([
      { appName: "salesforce", metadata: { appProfile: "revenova" } },
    ]);
    db.transaction.mockImplementationOnce(async (cb: any) =>
      cb({
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
            status: "RECEIVED",
            request: { junk: "data" },
          },
        ]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("Replica extraction failed for traceId 123");
  });

  it("should throw if extractor returns null (no stable entityId found)", async () => {
    hookBroker.extractReplica.mockResolvedValueOnce(null);
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("shard returned null");
  });

  it("should log nested error when error-handler transaction also fails", async () => {
    // Make error-handler tx reject → caught by inner catch(error_) and logged via this.logger.error
    db.transaction
      .mockRejectedValueOnce(new Error("db fail")) // main tx fails
      .mockRejectedValueOnce(new Error("rollback fail")); // error-handler tx → caught + logged
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    const loggerSpy = vi.spyOn((service as any).logger, "error");
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("db fail");

    const output = loggerSpy.mock.calls.flat().map(String).join(" ");
    expect(output).toMatch(/Failed to write L2 error state/);
    loggerSpy.mockRestore();
  });

  it("should swallow best-effort ReplicaQueue enqueue failure and resolve normally", async () => {
    // Simulate queue unavailability AFTER the transaction succeeds.
    // The .catch() in the service must swallow it — the transaction is already committed.
    queueService.send.mockRejectedValueOnce(new Error("queue unavailable"));
    db.transaction.mockImplementationOnce(async (cb: any) => {
      const mockInsert = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation(() => ({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "1" }]),
          }),
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
          then: (onfulfilled?: any) =>
            Promise.resolve(undefined as any).then(onfulfilled),
        })),
      }));
      return cb({
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            traceId: "123",
            objectType: "foo",
            extReqId: "bar",
            id: "1",
            status: "RECEIVED",
            request: {},
          },
        ]),
        insert: mockInsert,
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      });
    });
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).resolves.toBeUndefined();
  });

  it("should throw if extractor returns an entity with empty entityId", async () => {
    // hookBroker returns an entity with blank entityId
    hookBroker.extractReplica.mockResolvedValueOnce({
      entityType: "DEFAULT",
      entityId: "",
      data: {},
    });
    db.transaction.mockImplementationOnce(async (cb: any) =>
      cb({
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            traceId: "123",
            objectType: "sf_Account",
            extReqId: "",
            id: "1",
            status: "RECEIVED",
            request: {},
          },
        ]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("Cannot determine entityId");
  });

  it("should destroy module", () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });

  it("should skip processing if inbound record status is not RECEIVED or PENDING", async () => {
    const mockExecute = vi.fn();
    db.transaction.mockImplementationOnce(async (cb: any) =>
      cb({
        execute: mockExecute,
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            traceId: "123",
            objectType: "sf_Account",
            extReqId: "mock-id",
            id: "1",
            status: "COMPLETED", // Not RECEIVED or PENDING
            request: {},
          },
        ]),
        delete: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    // Extractor/insert should not be called (mockExecute only called for SET search_path)
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(queueService.send).toHaveBeenCalled();
  });

  it("should throw a FIFO error if activeSyncLocks insert fails due to unique constraint", async () => {
    const mockInsert = vi.fn().mockImplementation(() => {
      return {
        values: vi.fn().mockImplementation(() => {
          throw new Error("duplicate key value violates unique constraint");
        }),
      };
    });
    db.transaction.mockImplementationOnce(async (cb: any) =>
      cb({
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            traceId: "123",
            objectType: "sf_Account",
            extReqId: "mock-id",
            id: "1",
            status: "RECEIVED",
            request: {},
          },
        ]),
        delete: vi.fn().mockReturnThis(),
        insert: mockInsert,
        values: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("currently locked by an in-flight sync");
  });

  it("should rethrow generic errors during activeSyncLocks insert", async () => {
    const mockInsert = vi.fn().mockImplementation(() => {
      return {
        values: vi.fn().mockImplementation(() => {
          throw new Error("Generic database error");
        }),
      };
    });
    db.transaction.mockImplementationOnce(async (cb: any) =>
      cb({
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            traceId: "123",
            objectType: "sf_Account",
            extReqId: "mock-id",
            id: "1",
            status: "RECEIVED",
            request: {},
          },
        ]),
        delete: vi.fn().mockReturnThis(),
        insert: mockInsert,
        values: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("Generic database error");
  });
});
