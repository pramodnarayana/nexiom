/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { Test, TestingModule } from "@nestjs/testing";
import { InboundOutboxPoller } from "./inbound-outbox.poller.js";
import { DATABASE_CONNECTION, tenantStorageRegistry } from "@soopa/database";
import { QueueService, QueueName } from "@soopa/queue";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { DB_MANAGER } from "@soopa/dbmanager";

describe("InboundOutboxPoller", () => {
  let service: InboundOutboxPoller;
  let globalDb: any;
  let tenantDb: any;
  let dbManager: any;
  let queueService: any;
  let module: TestingModule;

  beforeEach(async () => {
    queueService = { send: vi.fn() };

    tenantDb = {
      select: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: "conn_1", appName: "test-app" }]),
      returning: vi.fn().mockResolvedValue([]),
      transaction: vi.fn().mockImplementation(async (cb: any) => {
        const tx = {
          execute: vi.fn(),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          returning: vi
            .fn()
            .mockResolvedValue([
              { id: "1", traceId: "t1", dataSourceId: "c1", attempts: 1 },
            ]),
        };
        return cb(tx);
      }),
    };

    globalDb = {
      select: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      from: vi.fn().mockImplementation((table: any) => {
        if (table === tenantStorageRegistry) {
          return Promise.resolve([{ tenantId: "tenant-1" }]);
        }
        return {
          where: vi
            .fn()
            .mockResolvedValue([{ id: "conn_1", appName: "test-app" }]),
        };
      }),
    };

    dbManager = {
      getTenantDb: vi.fn().mockResolvedValue(tenantDb),
    };

    module = await Test.createTestingModule({
      providers: [
        InboundOutboxPoller,
        { provide: DATABASE_CONNECTION, useValue: globalDb },
        { provide: QueueService, useValue: queueService },
        { provide: DB_MANAGER, useValue: dbManager },
      ],
    }).compile();

    service = module.get<InboundOutboxPoller>(InboundOutboxPoller);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  it("processOutbox should fetch workspaces and process rows", async () => {
    await service.processOutbox();
    expect(queueService.send).toHaveBeenCalledWith(QueueName.InboundQueue, {
      traceId: "t1",
      dataSourceId: "c1",
    });
    expect(tenantDb.update).toHaveBeenCalled();
  });

  it("should handle rejecting drainWorkspace gracefully", async () => {
    const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
    tenantDb.transaction.mockRejectedValueOnce(new Error("db down"));

    await service.processOutbox();

    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(
      loggerErrorSpy.mock.calls.some(
        (call: any[]) =>
          typeof call[0] === "string" &&
          call[0].includes("Failed to drain outbox"),
      ),
    ).toBe(true);
  });

  it("processOutbox should catch and log global DB errors", async () => {
    const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
    globalDb.select.mockImplementationOnce(() => {
      throw new Error("global db disconnected");
    });

    await service.processOutbox();

    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(
      loggerErrorSpy.mock.calls.some(
        (call: any[]) =>
          typeof call[0] === "string" &&
          call[0].includes("Failed to query global tenant registry"),
      ),
    ).toBe(true);
  });

  it("processOutbox should catch and log tenant processing errors", async () => {
    const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
    dbManager.getTenantDb.mockRejectedValueOnce(
      new Error("tenant db connection failed"),
    );

    await service.processOutbox();

    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(
      loggerErrorSpy.mock.calls.some(
        (call: any[]) =>
          typeof call[0] === "string" &&
          call[0].includes("Failed to process inbound outbox for tenant"),
      ),
    ).toBe(true);
  });

  it("should log unexpected failures when deliverRow rejects", async () => {
    const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
    vi.spyOn(service as any, "deliverRow").mockRejectedValueOnce(
      new Error("Delivery rejected"),
    );
    await service.processOutbox();
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it("should return early if tenants is empty", async () => {
    globalDb.from.mockImplementationOnce((table: any) => {
      if (table === tenantStorageRegistry) {
        return Promise.resolve([]);
      }
      return { where: vi.fn().mockResolvedValue([]) };
    });
    await service.processOutbox();
    expect(tenantDb.transaction).not.toHaveBeenCalled();
  });

  it("should return early if claimed is empty", async () => {
    tenantDb.transaction.mockImplementationOnce(async (cb: any) => {
      const tx = {
        execute: vi.fn(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };
      return cb(tx);
    });
    const loggerDebugSpy = vi.spyOn((service as any).logger, "debug");
    await service.processOutbox();
    expect(loggerDebugSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Claimed"),
    );
  });

  it("should catch and log tenant processing errors that are not instances of Error", async () => {
    dbManager.getTenantDb.mockRejectedValueOnce("string error");
    const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
    await service.processOutbox();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Failed to process inbound outbox for tenant tenant-1: string error",
      ),
    );
  });

  it("should catch and log global query errors that are not instances of Error", async () => {
    globalDb.from.mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "global string error";
    });
    const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
    await service.processOutbox();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("global string error"),
    );
  });

  it("should log unexpected failures when deliverRow rejects with non-Error", async () => {
    const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
    vi.spyOn(service as any, "deliverRow").mockRejectedValueOnce(
      "Delivery rejected string",
    );
    await service.processOutbox();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Delivery rejected string"),
    );
  });
});
