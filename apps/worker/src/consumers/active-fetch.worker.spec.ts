/* eslint-disable */
import { Test, TestingModule } from "@nestjs/testing";
import { ActiveFetchWorker } from "./active-fetch.worker.js";
import {} from "@soopa/pipeline";
import { QueueService, QueueName } from "@soopa/queue";
import { DATABASE_CONNECTION } from "@soopa/database";
import { PipelineHookBrokerService } from "@soopa/pipeline";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("ActiveFetchWorker", () => {
  let worker: ActiveFetchWorker;
  let queueService: any;
  let globalDb: any;
  let hookBroker: any;

  beforeEach(async () => {
    queueService = {
      consume: vi.fn((_queue, cb) => {
        // Store callback to manually trigger messages
        queueService.trigger = cb;
      }),
    };

    const mockLimit = vi
      .fn()
      .mockResolvedValue([
        { appName: "mock-app", metadata: { appProfile: "standard" } },
      ]);
    globalDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: mockLimit,
    };

    hookBroker = {
      activeFetch: vi.fn().mockResolvedValue(undefined),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ActiveFetchWorker,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: globalDb },
        { provide: PipelineHookBrokerService, useValue: hookBroker },
      ],
    }).compile();

    worker = moduleRef.get<ActiveFetchWorker>(ActiveFetchWorker);
  });

  it("should be defined", () => {
    expect(worker).toBeDefined();
  });

  it("should consume ActiveFetchQueue on init", () => {
    worker.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(
      QueueName.ActiveFetchQueue,
      expect.any(Function),
    );
  });

  it("should drop invalid messages", async () => {
    worker.onModuleInit();
    await queueService.trigger({});
    expect(globalDb.select).not.toHaveBeenCalled();
  });

  it("should throw error if connection not found", async () => {
    globalDb.limit.mockResolvedValueOnce([]); // no rows found
    worker.onModuleInit();

    await expect(
      queueService.trigger({
        traceId: "t1",
        dataSourceId: "c1",
        missingDependencies: [],
      }),
    ).rejects.toThrow(/Data source c1 not found/);
  });

  it("should call hookBroker.activeFetch when message is valid", async () => {
    worker.onModuleInit();

    await queueService.trigger({
      traceId: "t1",
      dataSourceId: "c1",
      missingDependencies: [{ entityType: "TMS_TP", sourceId: "source-1" }],
    });

    expect(hookBroker.activeFetch).toHaveBeenCalledWith(
      "mock-app",
      "standard",
      [{ entityType: "TMS_TP", sourceId: "source-1" }],
      "c1",
    );
  });

  it("should call hookBroker.activeFetch with standard profile when metadata does not specify appProfile", async () => {
    globalDb.limit.mockResolvedValueOnce([
      { appName: "quickbooks", metadata: null },
    ]);
    worker.onModuleInit();

    await queueService.trigger({
      traceId: "t1",
      dataSourceId: "c1",
      missingDependencies: [
        { entityType: "TMS_CUSTOMER", sourceId: "source-2" },
      ],
    });

    expect(hookBroker.activeFetch).toHaveBeenCalledWith(
      "quickbooks",
      "standard",
      [{ entityType: "TMS_CUSTOMER", sourceId: "source-2" }],
      "c1",
    );
  });

  it("should execute onModuleDestroy successfully", () => {
    expect(() => worker.onModuleDestroy()).not.toThrow();
  });
});
