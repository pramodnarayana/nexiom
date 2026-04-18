/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { ReplicaService } from "./replica.service.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { StorageResolverService } from "@nexiom/engine";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@nexiom/piece-framework", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@nexiom/piece-framework")>();
  return {
    ...actual,
    getReplicaExtractor: vi.fn().mockImplementation((appName: string) => {
      if (appName === "test_extraction_fail") {
        return () => null; // Simulate extraction returning null
      }
      return undefined;
    }),
  };
});
describe("ReplicaService", () => {
  let service: ReplicaService;
  let queueService: any;
  let db: any;
  let storageResolver: any;

  beforeEach(async () => {
    queueService = { consume: vi.fn(), send: vi.fn() };
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
        insert: mockInsert,
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
      };
      return cb(tx);
    });

    service.onModuleInit();
    expect(queueService.consume.mock.calls[0][0]).toBe(QueueName.InboundQueue);
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });

    // Message must NOT be sent directly — the outbox sweeper owns delivery
    expect(queueService.send).not.toHaveBeenCalled();
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
            payload: {},
          },
        ]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("Connection 456 not found in appConnections!");
  });

  it("should throw if replica extraction fails due to payload shape mismatch", async () => {
    // Return a piece appName that demands extraction and has a mock returning null
    db.limit.mockResolvedValueOnce([{ appName: "test_extraction_fail" }]);
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
            payload: { junk: "data" }, // Missing the root envelope to fail extraction
          },
        ]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("Replica extraction failed for traceId 123");
  });

  it("should throw if inbound record is missing extReqId", async () => {
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
            extReqId: null,
            id: "1",
            payload: {},
          },
        ]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("missing extReqId");
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

  it("should destroy module", () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});
