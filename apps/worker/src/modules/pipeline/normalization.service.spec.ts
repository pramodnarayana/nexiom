/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { NormalizationService } from "./normalization.service.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { StorageResolverService, PieceRegistryService } from "@nexiom/engine";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("NormalizationService", () => {
  let service: NormalizationService;
  let queueService: any;
  let db: any;
  let storageResolver: any;
  let pieceRegistry: any;

  beforeEach(async () => {
    queueService = { consume: vi.fn(), send: vi.fn() };
    db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ appName: "test_app" }]),
      transaction: vi.fn().mockImplementation(async (cb) => {
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
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          onConflictDoNothing: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
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
      ],
    }).compile();

    service = module.get<NormalizationService>(NormalizationService);
  });

  it("should process message normally", async () => {
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(
      QueueName.ReplicaQueue,
      expect.any(Function),
    );
    const handler = queueService.consume.mock.calls[0][1];

    await handler({ traceId: "123", connectionId: "456" });

    const expectedPayload = {
      traceId: "123",
      connectionId: "456",
    };

    expect(queueService.send).toHaveBeenCalledWith(
      QueueName.NormalizedQueue,
      expectedPayload,
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
    ).rejects.toThrow("Piece test_app not registered");
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
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
      };
      return cb(tx);
    });

    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", connectionId: "456" });
    // send should NOT be called because the record was already published
    expect(queueService.send).not.toHaveBeenCalled();
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
});
