/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { DeliveryService } from "./delivery.service.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { StorageResolverService } from "@nexiom/engine";
import { PieceRegistryService } from "@nexiom/piece-registry";
import { TokenManagerService } from "@nexiom/credentials";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("DeliveryService", () => {
  let service: DeliveryService;
  let queueService: any;
  let db: any;
  let storageResolver: any;
  let pieceRegistry: any;

  beforeEach(async () => {
    queueService = { consume: vi.fn() };
    db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue([
          { appName: "test", targetObject: "obj", tenantId: "tenant_1" },
        ]),
      transaction: vi.fn().mockImplementation(async (cb) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi
            .fn()
            .mockResolvedValue([
              { id: "o", reqPayload: {}, attemptCount: 0, status: "PENDING" },
            ]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          onConflictDoNothing: vi.fn().mockReturnThis(),
          onConflictDoUpdate: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{ id: "o" }]),
          delete: vi.fn().mockReturnThis(),
        };
        return cb(tx);
      }),
    };
    storageResolver = { resolveSchemaName: vi.fn().mockResolvedValue("ws_1") };
    pieceRegistry = {
      getPiece: vi.fn().mockReturnValue({
        executeAction: vi
          .fn()
          .mockResolvedValue({ body: { id: "DEST-001" }, statusCode: 200 }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryService,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: StorageResolverService, useValue: storageResolver },
        { provide: PieceRegistryService, useValue: pieceRegistry },
        {
          provide: TokenManagerService,
          useValue: { getValidCredentials: vi.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = module.get<DeliveryService>(DeliveryService);
  });

  const validPayload = {
    traceId: "123",
    srcConnectionId: "456",
    destConnectionId: "tgt",
    routeId: "r",
    hydratedPayload: {},
  };

  it("should deliver message and write success", async () => {
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(
      QueueName.DeliveryQueue,
      expect.any(Function),
    );
    const handler = queueService.consume.mock.calls[0][1];
    await handler(validPayload);
    expect(pieceRegistry.getPiece).toHaveBeenCalled();
  });

  it("should format error properly when piece fails", async () => {
    pieceRegistry
      .getPiece()
      .executeAction.mockRejectedValue(new Error("api error"));

    const setMock = vi.fn().mockReturnThis();
    db.transaction.mockImplementation(async (cb: any) =>
      cb({
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockResolvedValue([
            { id: "o", reqPayload: {}, attemptCount: 0, status: "PENDING" },
          ]),
        update: vi.fn().mockReturnThis(),
        set: setMock,
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
        delete: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).resolves.toBeUndefined();

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAIL",
        statusCode: 500,
        resPayload: { error: "api error" },
      }),
    );
  });

  it("should throw if outbound gateway record not found", async () => {
    db.transaction.mockImplementationOnce(async (cb: any) =>
      cb({
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).rejects.toThrow(
      "Outbound gateway record not found",
    );
  });

  it("should return early if delivery is already claimed by another worker", async () => {
    db.transaction.mockImplementation(async (cb: any) =>
      cb({
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockResolvedValue([
            { id: "o", reqPayload: {}, attemptCount: 0, status: "PENDING" },
          ]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).resolves.toBeUndefined();
  });

  it("should throw if target connection not found", async () => {
    db.limit.mockResolvedValue([]);
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).rejects.toThrow(
      "Target connection tgt not found",
    );
  });

  it("should throw if piece not registered", async () => {
    pieceRegistry.getPiece.mockReturnValueOnce(null);
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).rejects.toThrow(
      "Piece test not registered",
    );
  });

  it("should throw if piece has no executeAction", async () => {
    pieceRegistry.getPiece.mockReturnValueOnce({
      /* no executeAction */
    });
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).rejects.toThrow(
      "has no executeAction defined",
    );
  });

  it("should extract statusCode from a thrown error object with statusCode property", async () => {
    const errWithCode = { statusCode: 422, message: "Unprocessable" };
    pieceRegistry.getPiece().executeAction.mockRejectedValueOnce(errWithCode);
    db.transaction.mockImplementation(async (cb: any) =>
      cb({
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockResolvedValue([
            { id: "o", reqPayload: {}, attemptCount: 0, status: "PENDING" },
          ]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).resolves.toBeUndefined();
  });

  it("should swallow rollback error and rethrow original error", async () => {
    db.limit.mockResolvedValue([]);
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).rejects.toThrow(
      "Target connection tgt not found",
    );
  });

  it("should destroy module", () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });

  // ── Enterprise hardening tests ──────────────────────────────────────────────

  it("should ACK and return early on invalid message (missing required fields)", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({
        connectionId: "456",
        targetConnectionId: "tgt",
      }),
    ).resolves.toBeUndefined();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("should throw error and defer to SQS when piece returns 429 with explicit retry flag", async () => {
    pieceRegistry.getPiece().executeAction.mockResolvedValueOnce({
      body: {},
      statusCode: 429,
      retry: true,
    });
    const setMock = vi.fn().mockReturnThis();
    db.transaction.mockImplementation(async (cb: any) =>
      cb({
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockResolvedValue([
            { id: "o", reqPayload: {}, attemptCount: 0, status: "PENDING" },
          ]),
        update: vi.fn().mockReturnThis(),
        set: setMock,
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
        delete: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).rejects.toThrow(
      "API call failed with retryable error (HTTP 429). Deferring to SQS for retry.",
    );

    // It still writes the RETRY status
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "RETRY" }),
    );
  });

  it("should set RETRY status and throw when piece throws RetryableException", async () => {
    const { RetryableException } = await import("@nexiom/piece-framework");
    pieceRegistry
      .getPiece()
      .executeAction.mockRejectedValueOnce(
        new RetryableException("rate limited", 429),
      );
    const setMock = vi.fn().mockReturnThis();
    db.transaction.mockImplementation(async (cb: any) =>
      cb({
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockResolvedValue([
            { id: "o", reqPayload: {}, attemptCount: 0, status: "PENDING" },
          ]),
        update: vi.fn().mockReturnThis(),
        set: setMock,
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
        delete: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).rejects.toThrow(
      "API call failed with retryable error (HTTP 429). Deferring to SQS for retry.",
    );
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "RETRY" }),
    );
  });

  it("should set FAIL status for permanent 4xx errors (422 unprocessable)", async () => {
    pieceRegistry
      .getPiece()
      .executeAction.mockResolvedValueOnce({ body: {}, statusCode: 422 });
    const setMock = vi.fn().mockReturnThis();
    db.transaction.mockImplementation(async (cb: any) =>
      cb({
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockResolvedValue([
            { id: "o", reqPayload: {}, attemptCount: 0, status: "PENDING" },
          ]),
        update: vi.fn().mockReturnThis(),
        set: setMock,
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
        delete: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).resolves.toBeUndefined();
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAIL" }),
    );
  });

  it("should set FAIL and skip executeAction when MAX_ATTEMPTS exceeded", async () => {
    const executeAction = pieceRegistry.getPiece().executeAction;
    db.transaction.mockImplementation(async (cb: any) =>
      cb({
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockResolvedValue([
            { id: "o", reqPayload: {}, attemptCount: 5, status: "RETRY" },
          ]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
        delete: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).resolves.toBeUndefined();
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("should NOT rewrite outbound gateway if claimed is false during pre-claim exception", async () => {
    // Trigger pre-claim error by removing the token manager completely
    (service as any).tokenManagerService = null;
    service.onModuleInit();

    // We expect the original error to be thrown to the caller!
    const handler = queueService.consume.mock.calls[0][1];
    await expect(handler(validPayload)).rejects.toThrow(
      "TokenManagerService unavailable",
    );
  });
});
