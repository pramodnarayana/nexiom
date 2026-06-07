/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from "@nestjs/testing";
import { ReplicaService } from "./replica.service.js";
import { QueueService, QueueName } from "@soopa/queue";
import { DATABASE_CONNECTION } from "@soopa/database";
import {
  StorageResolverService,
  PipelineHookBrokerService,
} from "@soopa/engine";
import { DB_MANAGER } from "@soopa/dbmanager";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("ReplicaService", () => {
  let service: ReplicaService;
  let queueService: any;
  let db: any;
  let storageResolver: any;
  let hookBroker: any;
  let replicaStatePort: any;

  beforeEach(async () => {
    queueService = {
      consume: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
    };
    hookBroker = {
      extractReplica: vi.fn().mockResolvedValue({
        entityType: "sf_Account",
        entityId: "mock-entity-id",
        data: {},
      }),
    };
    db = {
      query: {
        dataSources: {
          findFirst: vi.fn().mockResolvedValue({
            appName: "salesforce",
            metadata: { appProfile: "revenova" },
          }),
        },
      },
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          appName: "salesforce",
          metadata: { appProfile: "revenova" },
        },
      ]),
    };
    storageResolver = {
      resolveSchemaName: vi.fn().mockResolvedValue("ws_1"),
      resolveStorageProfile: vi
        .fn()
        .mockResolvedValue({ schemaName: "ws_1", tenantId: "tenant_1" }),
    };

    replicaStatePort = {
      fetchInboundRecord: vi.fn().mockResolvedValue({
        id: "1",
        traceId: "123",
        status: "RECEIVED",
        request: {},
      }),
      persistReplicaExtraction: vi.fn().mockResolvedValue(undefined),
      markInboundFail: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: DB_MANAGER,
          useValue: { getTenantDb: vi.fn().mockResolvedValue(db) },
        },
        ReplicaService,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: StorageResolverService, useValue: storageResolver },
        { provide: PipelineHookBrokerService, useValue: hookBroker },
        { provide: "IReplicaStatePort", useValue: replicaStatePort },
      ],
    }).compile();

    service = module.get<ReplicaService>(ReplicaService);
  });

  it("should process message successfully and write to replicaOutbox atomically", async () => {
    service.onModuleInit();
    expect(queueService.consume.mock.calls[0][0]).toBe(QueueName.InboundQueue);
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", dataSourceId: "456" });

    expect(replicaStatePort.fetchInboundRecord).toHaveBeenCalledWith(
      "tenant_1",
      "ws_1",
      "123",
    );
    expect(replicaStatePort.persistReplicaExtraction).toHaveBeenCalled();
    const callArgs = replicaStatePort.persistReplicaExtraction.mock.calls[0];
    expect(callArgs[3]).toBe("123"); // traceId
    expect(callArgs[5].entityId).toBe("mock-entity-id");
  });

  it("should handle errors gracefully and update sync log to FAIL", async () => {
    replicaStatePort.persistReplicaExtraction.mockRejectedValueOnce(
      new Error("db fail"),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", dataSourceId: "456" }),
    ).rejects.toThrow("db fail");
    expect(replicaStatePort.markInboundFail).toHaveBeenCalled();
  });

  it("should throw if inbound record not found", async () => {
    replicaStatePort.fetchInboundRecord.mockResolvedValueOnce(null);
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", dataSourceId: "456" }),
    ).rejects.toThrow("Inbound record for traceId 123 not found");
  });

  it("should throw if connection not found in dataSources", async () => {
    db.limit.mockResolvedValueOnce([]);
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", dataSourceId: "456" }),
    ).rejects.toThrow("Missing dependencies: connection:456");
  });

  it("should throw if replica extraction fails due to payload shape mismatch", async () => {
    hookBroker.extractReplica.mockRejectedValueOnce(new Error("extract fail"));
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", dataSourceId: "456" }),
    ).rejects.toThrow("extract fail");
  });

  it("should throw if extractor returns null (no stable entityId found)", async () => {
    hookBroker.extractReplica.mockResolvedValueOnce(null);
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", dataSourceId: "456" }),
    ).rejects.toThrow("shard returned null");
  });

  it("should log nested error when error-handler transaction also fails", async () => {
    replicaStatePort.persistReplicaExtraction.mockRejectedValueOnce(
      new Error("db fail"),
    );
    replicaStatePort.markInboundFail.mockRejectedValueOnce(
      new Error("rollback fail"),
    );
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];

    const loggerSpy = vi.spyOn((service as any).logger, "error");
    await expect(
      handler({ traceId: "123", dataSourceId: "456" }),
    ).rejects.toThrow("db fail");

    const output = loggerSpy.mock.calls.flat().map(String).join(" ");
    expect(output).toMatch(/Failed to write L2 error state/);
    loggerSpy.mockRestore();
  });

  it("should throw if extractor returns an entity with empty entityId", async () => {
    hookBroker.extractReplica.mockResolvedValueOnce({
      entityType: "DEFAULT",
      entityId: "",
      data: {},
    });
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await expect(
      handler({ traceId: "123", dataSourceId: "456" }),
    ).rejects.toThrow("Cannot determine entityId");
  });

  it("should destroy module", () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });

  it("should skip processing if inbound record status is not RECEIVED or PENDING", async () => {
    replicaStatePort.fetchInboundRecord.mockResolvedValueOnce({
      id: "1",
      traceId: "123",
      status: "COMPLETED",
      request: {},
    });
    service.onModuleInit();
    const handler = queueService.consume.mock.calls[0][1];
    await handler({ traceId: "123", dataSourceId: "456" });

    expect(hookBroker.extractReplica).not.toHaveBeenCalled();
    expect(replicaStatePort.persistReplicaExtraction).not.toHaveBeenCalled();
  });
});
