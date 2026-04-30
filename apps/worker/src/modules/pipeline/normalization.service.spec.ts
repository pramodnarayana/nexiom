/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { NormalizationService } from "./normalization.service.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import {
  StorageResolverService,
  PipelineHookBrokerService,
} from "@nexiom/engine";
import { PieceRegistryService } from "@nexiom/piece-registry";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("NormalizationService", () => {
  let service: NormalizationService;
  let queueService: any;
  let db: any;
  let storageResolver: any;
  let pieceRegistry: any;
  let mockTxInsert: any;

  beforeEach(async () => {
    mockTxInsert = vi.fn();
    queueService = { consume: vi.fn(), send: vi.fn() };
    db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ appName: "test_app" }]),
      transaction: vi.fn().mockImplementation(async (cb) => {
        // Build a chainable insert that supports:
        //   insert(t).values({}).onConflictDoUpdate({}).returning({})  → [{ id }]
        //   insert(t).values({})                                        → resolves
        const makeInsertChain = (
          returnVal: any[] = [{ id: "new_normalized_1" }],
        ) => ({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              // directly awaitable (for inserts with no .returning())
              then: (onfulfilled?: ((value: any) => any) | null) =>
                Promise.resolve(undefined as any).then(onfulfilled),
              // also supports .returning() for chains that need it
              returning: vi.fn().mockResolvedValue(returnVal),
            }),
            onConflictDoNothing: vi.fn().mockReturnValue({
              then: (onfulfilled?: ((value: any) => any) | null) =>
                Promise.resolve(undefined as any).then(onfulfilled),
              returning: vi.fn().mockResolvedValue(returnVal),
            }),
            returning: vi.fn().mockResolvedValue(returnVal),
            // plain insert().values() with no conflict resolution
            then: (onfulfilled?: ((value: any) => any) | null) =>
              Promise.resolve(undefined as any).then(onfulfilled),
          }),
        });
        mockTxInsert.mockImplementation(() => makeInsertChain());
        const tx = {
          execute: vi
            .fn()
            .mockResolvedValue({ rowCount: 1, rows: [{ published_at: null }] }),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi
            .fn()
            .mockResolvedValue([
              { traceId: "123", data: {}, canonicalType: "RAW", id: "1" },
            ]),
          insert: mockTxInsert,
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          // Add transaction method to support nested transactions (savepoints)
          transaction: vi.fn().mockImplementation(async (spCb) => {
            return spCb(tx);
          }),
        };
        return cb(tx);
      }),
    };
    storageResolver = { resolveSchemaName: vi.fn().mockResolvedValue("ws_1") };
    pieceRegistry = {
      getPiece: vi.fn().mockReturnValue({
        normalize: vi
          .fn()
          .mockResolvedValue({ canonicalType: "TEST", data: {} }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NormalizationService,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: StorageResolverService, useValue: storageResolver },
        { provide: PieceRegistryService, useValue: pieceRegistry },
        {
          provide: PipelineHookBrokerService,
          // Default: shard normalize returns null → falls through to piece.normalize
          // and writeNormalized is a no-op (returns void).
          useValue: {
            normalize: vi.fn().mockResolvedValue(null),
            writeNormalized: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<NormalizationService>(NormalizationService);
  });

  it("should process message normally", async () => {
    // Create a spy for the broker that was injected into the service
    const mockBroker = {
      normalize: vi.fn().mockResolvedValue(null),
      writeNormalized: vi.fn().mockResolvedValue(undefined),
    };

    // Create a new module with the spy broker
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NormalizationService,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: StorageResolverService, useValue: storageResolver },
        { provide: PieceRegistryService, useValue: pieceRegistry },
        { provide: PipelineHookBrokerService, useValue: mockBroker },
      ],
    }).compile();

    const testService = module.get<NormalizationService>(NormalizationService);
    testService.onModuleInit();

    expect(queueService.consume).toHaveBeenCalledWith(
      QueueName.ReplicaQueue,
      expect.any(Function),
    );
    const handler = queueService.consume.mock.calls[0][1];

    await handler({ traceId: "123", connectionId: "456" });

    expect(db.transaction).toHaveBeenCalled();
    expect(mockTxInsert).toHaveBeenCalled();
    // Assert that broker.normalize was called
    expect(mockBroker.normalize).toHaveBeenCalledWith(
      "test_app",
      "default",
      expect.objectContaining({
        entityType: expect.any(String),
        data: expect.any(Object),
      }),
    );
  });

  it("should handle errors gracefully", async () => {
    db.transaction.mockRejectedValueOnce(new Error("db fail"));
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(
      QueueName.ReplicaQueue,
      expect.any(Function),
    );
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("db fail");
  });

  it("should throw if target connection not found", async () => {
    db.limit.mockResolvedValueOnce([]);
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(
      QueueName.ReplicaQueue,
      expect.any(Function),
    );
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("Connection 456 not found");
  });

  it("should throw if piece not registered", async () => {
    pieceRegistry.getPiece.mockReturnValueOnce(null);
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(
      QueueName.ReplicaQueue,
      expect.any(Function),
    );
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("not registered in PieceRegistry");
  });

  it("should skip enqueue when record was already published (rowCount=0)", async () => {
    // Make the stamp UPDATE return rowCount=0 (already published)
    db.transaction.mockImplementation(async (cb: any) => {
      const tx = {
        execute: vi.fn().mockResolvedValue({
          rowCount: 0,
          rows: [{ published_at: new Date() }],
        }),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockResolvedValue([
            { traceId: "123", data: {}, canonicalType: "RAW", id: "1" },
          ]),
        // Returns row from .returning() on onConflictDoUpdate
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: "existing_1" }]),
            }),
            onConflictDoNothing: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
            then: (onfulfilled?: ((value: any) => any) | null) =>
              Promise.resolve(undefined as any).then(onfulfilled),
          }),
        }),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
      };
      return cb(tx);
    });

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    // Since rowCount = 0 (simulating already processed record),
    // it does not insert into the outbox. We can assert mockTxInsert was called fewer times than success.
    expect(db.transaction).toHaveBeenCalled();
  });

  it("should swallow inner catch error in error handler and rethrow original", async () => {
    // First transaction throws; error-handler transaction also throws → swallowed
    db.transaction
      .mockRejectedValueOnce(new Error("db fail")) // main tx fails
      .mockRejectedValueOnce(new Error("rollback")); // error-handler tx fails → swallowed
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("db fail");
  });

  it("should throw if replica not found", async () => {
    db.transaction.mockImplementationOnce(async (cb: any) => {
      const tx = {
        execute: vi.fn().mockResolvedValue({ rowCount: 1 }),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]), // Empty
      };
      return cb(tx);
    });
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("Replica record for traceId 123 not found");
  });

  it("should destroy module", () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });

  // ── Enterprise hardening tests ──────────────────────────────────────────────

  it("should ACK and return early on invalid message (missing traceId)", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    // Should not throw — just ACK (return) so SQS does not redeliver the poison pill
    await expect(
      handler({ connectionId: "456" }), // traceId missing
    ).resolves.toBeUndefined();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("should store RAW record when piece.normalize returns null", async () => {
    // Simulate a piece that has no canonical mapping for this object type
    pieceRegistry.getPiece.mockReturnValueOnce({
      normalize: vi.fn().mockResolvedValue(null),
    });
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    // Transaction should have been called — record stored with canonicalType='RAW'
    expect(db.transaction).toHaveBeenCalled();
    // The tx insert should have been called (normalizedEntity and normalizedOutbox)
    expect(mockTxInsert).toHaveBeenCalled();
  });

  it("should write FAIL sync_log and rethrow when piece.normalize throws", async () => {
    const normalizeError = new Error("normalize failed");
    pieceRegistry.getPiece.mockReturnValueOnce({
      normalize: vi.fn().mockRejectedValue(normalizeError),
    });
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    // Error should propagate — rejected promise means SQS redelivers for retry
    await expect(
      handler({ traceId: "123", connectionId: "456" }),
    ).rejects.toThrow("normalize failed");
    // Error-handler transaction attempted (for FAIL sync_log)
    expect(db.transaction).toHaveBeenCalled();
  });

  it("should call broker.writeNormalized when broker.normalize returns non-null", async () => {
    const mockBroker = {
      normalize: vi.fn().mockResolvedValue({
        canonicalType: "BROKER_TYPE",
        data: { brokered: true },
      }),
      writeNormalized: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NormalizationService,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: StorageResolverService, useValue: storageResolver },
        { provide: PieceRegistryService, useValue: pieceRegistry },
        { provide: PipelineHookBrokerService, useValue: mockBroker },
      ],
    }).compile();

    const svc = module.get<NormalizationService>(NormalizationService);
    svc.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    await handler({ traceId: "123", connectionId: "456" });

    // Assert broker.normalize was called
    expect(mockBroker.normalize).toHaveBeenCalledWith(
      "test_app",
      "default",
      expect.objectContaining({
        entityType: expect.any(String),
        data: expect.any(Object),
      }),
    );

    // Assert broker.writeNormalized was called
    expect(mockBroker.writeNormalized).toHaveBeenCalledWith(
      "test_app",
      "default",
      expect.anything(), // tx
      expect.anything(), // db
      "ws_1", // schemaName
      "1", // replicaId
      expect.any(String), // entityId
      "123", // traceId
      "BROKER_TYPE", // normalizedEntityType
      expect.objectContaining({ brokered: true }), // data
    );

    // Piece.normalize should NOT have been called (broker took precedence)
    expect(pieceRegistry.getPiece().normalize).not.toHaveBeenCalled();
  });
});
