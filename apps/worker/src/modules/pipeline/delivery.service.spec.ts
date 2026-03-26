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
          limit: vi.fn().mockResolvedValue([{ reqPayload: {} }]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{ id: "o" }]),
        };
        return cb(tx);
      }),
    };
    storageResolver = { resolveSchemaName: vi.fn().mockResolvedValue("ws_1") };
    pieceRegistry = {
      getPiece: vi.fn().mockReturnValue({
        executeAction: vi.fn().mockResolvedValue({ body: {}, statusCode: 200 }),
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
        returning: vi.fn().mockResolvedValue([{ id: "o" }]),
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ reqPayload: {} }]),
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
});
