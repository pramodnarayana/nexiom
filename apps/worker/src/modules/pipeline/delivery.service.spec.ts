/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { DeliveryService } from "./delivery.service.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { StorageResolverService, PieceRegistryService } from "@nexiom/engine";
import { TokenManagerService } from "@nexiom/connectors";
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
        .mockResolvedValue([{ appName: "test", targetObject: "obj" }]),
      transaction: vi.fn().mockImplementation(async (cb) => {
        const tx = {
          execute: vi.fn(),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi
            .fn()
            .mockResolvedValue([{ reqPayload: {}, attemptCount: 0 }]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          onConflictDoNothing: vi.fn().mockReturnThis(),
          onConflictDoUpdate: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{ id: "o" }]),
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
    // Return target appName + tenantId from the non-transactional select chain
    db.limit.mockResolvedValue([
      { appName: "test", targetObject: "obj", tenantId: "tenant_1" },
    ]);

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

  it("should deliver message and write success", async () => {
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(
      QueueName.DeliveryQueue,
      expect.any(Function),
    );
    const handler = queueService.consume.mock.calls[0][1];
    await handler({
      traceId: "123",
      connectionId: "456",
      targetConnectionId: "tgt",
      routeId: "r",
      outboundGatewayId: "o",
    });
    expect(pieceRegistry.getPiece).toHaveBeenCalled();
  });

  it("should format error properly when piece fails", async () => {
    pieceRegistry
      .getPiece()
      .executeAction.mockRejectedValue(new Error("api error"));

    const setMock = vi.fn().mockReturnThis();
    db.transaction.mockImplementation(async (cb: any) =>
      cb({
        update: vi.fn().mockReturnThis(),
        set: setMock,
        where: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ reqPayload: {}, attemptCount: 0 }]),
      }),
    );
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(
      QueueName.DeliveryQueue,
      expect.any(Function),
    );
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({
        traceId: "123",
        connectionId: "456",
        targetConnectionId: "tgt",
        routeId: "r",
        outboundGatewayId: "o",
      }),
    ).resolves.toBeUndefined();

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
      }),
    );
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(
      QueueName.DeliveryQueue,
      expect.any(Function),
    );
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({
        traceId: "123",
        connectionId: "456",
        targetConnectionId: "tgt",
        routeId: "r",
        outboundGatewayId: "o",
      }),
    ).rejects.toThrow("Outbound gateway record not found");
  });

  it("should return early if delivery is already claimed by another worker", async () => {
    db.transaction.mockImplementation(async (cb: any) =>
      cb({
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ reqPayload: {} }]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(
      QueueName.DeliveryQueue,
      expect.any(Function),
    );
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({
        traceId: "123",
        connectionId: "456",
        targetConnectionId: "tgt",
        routeId: "r",
        outboundGatewayId: "o",
      }),
    ).resolves.toBeUndefined();
  });

  it("should throw if target connection not found", async () => {
    db.limit.mockResolvedValueOnce([]);
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({
        traceId: "123",
        connectionId: "456",
        targetConnectionId: "tgt",
        routeId: "r",
        outboundGatewayId: "o",
      }),
    ).rejects.toThrow("Target connection tgt not found");
  });

  it("should throw if piece not registered", async () => {
    pieceRegistry.getPiece.mockReturnValueOnce(null);
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({
        traceId: "123",
        connectionId: "456",
        targetConnectionId: "tgt",
        routeId: "r",
        outboundGatewayId: "o",
      }),
    ).rejects.toThrow("Piece test not registered");
  });

  it("should throw if piece has no executeAction", async () => {
    pieceRegistry.getPiece.mockReturnValueOnce({
      /* no executeAction */
    });
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({
        traceId: "123",
        connectionId: "456",
        targetConnectionId: "tgt",
        routeId: "r",
        outboundGatewayId: "o",
      }),
    ).rejects.toThrow("has no executeAction defined");
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
        limit: vi.fn().mockResolvedValue([{ reqPayload: {}, attemptCount: 0 }]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({
        traceId: "123",
        connectionId: "456",
        targetConnectionId: "tgt",
        routeId: "r",
        outboundGatewayId: "o",
      }),
    ).resolves.toBeUndefined();
  });

  it("should swallow rollback error and rethrow original error", async () => {
    // First resolveSchemaName works; make the outer try fail by rejecting connDocs lookup.
    // Then the error-handler resolveSchemaName also fails → swallowed by inner catch {}.
    db.limit.mockResolvedValueOnce([]);
    storageResolver.resolveSchemaName
      .mockResolvedValueOnce("ws_1") // outer try: fetch outbound tx → ok
      .mockRejectedValueOnce(new Error("rollback fail")); // error-handler → swallowed
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({
        traceId: "123",
        connectionId: "456",
        targetConnectionId: "tgt",
        routeId: "r",
        outboundGatewayId: "o",
      }),
    ).rejects.toThrow("Target connection tgt not found");
  });

  it("should destroy module", () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });

  // ── Enterprise hardening tests ──────────────────────────────────────────────

  it("should ACK and return early on invalid message (missing traceId)", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({
        connectionId: "456",
        targetConnectionId: "tgt",
        routeId: "r",
        outboundGatewayId: "o",
      }),
    ).resolves.toBeUndefined();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("should set RETRY status when piece returns 429 with explicit retry flag", async () => {
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
        limit: vi.fn().mockResolvedValue([{ reqPayload: {}, attemptCount: 0 }]),
        update: vi.fn().mockReturnThis(),
        set: setMock,
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({
      traceId: "t1",
      connectionId: "456",
      targetConnectionId: "tgt",
      routeId: "r",
      outboundGatewayId: "o",
    });
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "RETRY" }),
    );
  });

  it("should set RETRY status when piece returns 503 with explicit retry flag", async () => {
    pieceRegistry.getPiece().executeAction.mockResolvedValueOnce({
      body: {},
      statusCode: 503,
      retry: true,
    });
    const setMock = vi.fn().mockReturnThis();
    db.transaction.mockImplementation(async (cb: any) =>
      cb({
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ reqPayload: {}, attemptCount: 0 }]),
        update: vi.fn().mockReturnThis(),
        set: setMock,
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({
      traceId: "t1",
      connectionId: "456",
      targetConnectionId: "tgt",
      routeId: "r",
      outboundGatewayId: "o",
    });
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "RETRY" }),
    );
  });

  it("should set RETRY status when piece throws RetryableException", async () => {
    const { RetryableException } = await import("@nexiom/connectors");
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
        limit: vi.fn().mockResolvedValue([{ reqPayload: {}, attemptCount: 0 }]),
        update: vi.fn().mockReturnThis(),
        set: setMock,
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({
      traceId: "t1",
      connectionId: "456",
      targetConnectionId: "tgt",
      routeId: "r",
      outboundGatewayId: "o",
    });
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
        limit: vi.fn().mockResolvedValue([{ reqPayload: {}, attemptCount: 0 }]),
        update: vi.fn().mockReturnThis(),
        set: setMock,
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({
      traceId: "t1",
      connectionId: "456",
      targetConnectionId: "tgt",
      routeId: "r",
      outboundGatewayId: "o",
    });
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
        // attemptCount >= 5 triggers MAX_ATTEMPTS guard
        limit: vi.fn().mockResolvedValue([{ reqPayload: {}, attemptCount: 5 }]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
      }),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({
      traceId: "t1",
      connectionId: "456",
      targetConnectionId: "tgt",
      routeId: "r",
      outboundGatewayId: "o",
    });
    // executeAction must NOT have been called — piece protected from overuse
    expect(executeAction).not.toHaveBeenCalled();
  });
  it("should NOT rewrite outbound gateway if claimed is false during pre-claim exception", async () => {
    const updateSpy = vi.fn().mockReturnThis();
    db.transaction.mockImplementation(async (cb: any) =>
      cb({
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ reqPayload: {}, attemptCount: 0 }]),
        update: updateSpy,
        set: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      }),
    );
    // Trigger pre-claim error by removing the token manager completely
    (service as any).tokenManagerService = null;
    service.onModuleInit();

    // We expect the original error to be thrown to the caller!
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({
        traceId: "t1",
        connectionId: "456",
        targetConnectionId: "tgt",
        routeId: "r",
        outboundGatewayId: "o",
      }),
    ).rejects.toThrow("TokenManagerService unavailable");

    // The catch block must NOT have executed update set status = FAIL
    // Since it was during an un-claimed state (token resolution is before DB claim)
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
