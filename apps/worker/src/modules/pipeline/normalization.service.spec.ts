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
          execute: vi.fn(),
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
});
