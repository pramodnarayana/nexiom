/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { NormalizationService } from "./normalization.service.js";
import { QueueService, QueueName } from "@soopa/queue";
import { DATABASE_CONNECTION } from "@soopa/database";
import {
  StorageResolverService,
  PipelineHookBrokerService,
} from "@soopa/engine";
import { PieceRegistryService } from "@soopa/piece-registry";
import { DB_MANAGER } from "@soopa/dbmanager";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("NormalizationService", () => {
  let service: NormalizationService;
  let queueService: any;
  let db: any;
  let globalDb: any;
  let storageResolver: any;
  let pieceRegistry: any;
  let mockTxInsert: any;
  let hookBroker: any;

  beforeEach(async () => {
    mockTxInsert = vi.fn();
    queueService = { consume: vi.fn(), send: vi.fn() };

    globalDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue([
          { appName: "test_app", metadata: { appProfile: "test_profile" } },
        ]),
    };

    db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ appName: "test_app" }]),
      transaction: vi.fn().mockImplementation(async (cb) => {
        const makeInsertChain = (
          returnVal: any[] = [{ id: "new_normalized_1" }],
        ) => ({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              then: (onfulfilled?: ((value: any) => any) | null) =>
                Promise.resolve(undefined as any).then(onfulfilled),
              returning: vi.fn().mockResolvedValue(returnVal),
            }),
            onConflictDoNothing: vi.fn().mockReturnValue({
              then: (onfulfilled?: ((value: any) => any) | null) =>
                Promise.resolve(undefined as any).then(onfulfilled),
              returning: vi.fn().mockResolvedValue(returnVal),
            }),
            returning: vi.fn().mockResolvedValue(returnVal),
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
          limit: vi.fn().mockResolvedValue([
            {
              traceId: "123",
              data: {},
              canonicalType: "RAW",
              id: "1",
              entityType: "test_entity",
              entityId: "test_entity_id",
            },
          ]),
          insert: mockTxInsert,
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          transaction: vi.fn().mockImplementation(async (spCb) => spCb(tx)),
        };
        return cb(tx);
      }),
    };
    storageResolver = {
      resolveSchemaName: vi.fn().mockResolvedValue("ws_1"),
      resolveStorageProfile: vi
        .fn()
        .mockResolvedValue({ schemaName: "ws_1", tenantId: "tenant_1" }),
    };
    pieceRegistry = {
      getPiece: vi.fn().mockReturnValue({
        normalize: vi
          .fn()
          .mockResolvedValue({ canonicalType: "TEST", data: {} }),
      }),
    };

    hookBroker = {
      normalize: vi.fn().mockResolvedValue(null),
      writeNormalized: vi.fn().mockResolvedValue(undefined),
      extractReplica: vi.fn().mockResolvedValue({ entityId: "test_entity_id" }),
      reverseLookup: vi.fn().mockResolvedValue(["parent_trace_1"]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: DB_MANAGER,
          useValue: { getTenantDb: vi.fn().mockResolvedValue(db) },
        },
        NormalizationService,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: globalDb },
        { provide: StorageResolverService, useValue: storageResolver },
        { provide: PieceRegistryService, useValue: pieceRegistry },
        { provide: PipelineHookBrokerService, useValue: hookBroker },
      ],
    }).compile();

    service = module.get<NormalizationService>(NormalizationService);
  });

  it("should process message normally", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", dataSourceId: "456" });
    expect(db.transaction).toHaveBeenCalled();
  });

  it("should process message with valid passed schemaName", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", dataSourceId: "456", schemaName: "ws_1" });
    expect(db.transaction).toHaveBeenCalled();
  });

  it("should throw if passed schemaName mismatches storage profile", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", dataSourceId: "456", schemaName: "ws_2" }),
    ).rejects.toThrow("Schema ownership mismatch");
  });

  it("should throw if globalDb target connection not found", async () => {
    globalDb.limit.mockResolvedValueOnce([]);
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", dataSourceId: "456" }),
    ).rejects.toThrow("not found in dataSources");
  });

  it("should handle superseded check logic", async () => {
    db.transaction.mockImplementationOnce(async (cb: any) => {
      const tx = {
        execute: vi.fn(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockResolvedValueOnce([]) // Not exact match
          .mockResolvedValueOnce([{ request: {} }]) // Inbound
          .mockResolvedValueOnce([{ id: "other", traceId: "other" }]), // Superseded
      };
      return cb(tx);
    });
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", dataSourceId: "456" });
    // Returns gracefully without inserting
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("should requeue parent from reverse lookup", async () => {
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", dataSourceId: "456" });
    // It should have requeued parent trace
    expect(queueService.send).toHaveBeenCalledWith(QueueName.NormalizedQueue, {
      traceId: "parent_trace_1",
      dataSourceId: "456",
    });
  });

  it("should catch and log error in application hook without throwing", async () => {
    hookBroker.writeNormalized.mockRejectedValueOnce(new Error("Hook failed"));
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", dataSourceId: "456" });
    // Doesn't throw
    expect(db.transaction).toHaveBeenCalled();
  });

  it("should leave outbox pending if queue service send fails", async () => {
    queueService.send.mockRejectedValueOnce(new Error("Queue error"));
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", dataSourceId: "456" });
    // Does not throw, outbox remains PENDING
    expect(db.transaction).toHaveBeenCalled();
  });
});
