/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { Test, TestingModule } from "@nestjs/testing";
import { InboundOutboxPoller } from "./inbound-outbox.poller.js";
import { DATABASE_CONNECTION, tenantStorageRegistry } from "@soopa/database";
import { QueueService, QueueName } from "@soopa/queue";
import { describe, it, expect, vi, beforeEach } from "vitest";

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
      transaction: vi.fn().mockImplementation(async (cb) => {
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
    // It should fetch workspaces ws_1 and ws_2, and for both, it mocks claiming 1 row.
    // The claimed row is successfully delivered to QueueName.InboundQueue
    expect(queueService.send).toHaveBeenCalledWith(QueueName.InboundQueue, {
      traceId: "t1",
      dataSourceId: "c1",
    });
    expect(tenantDb.update).toHaveBeenCalled();
  });

  it("processOutboxRow should retry on failure", async () => {
    queueService.send.mockRejectedValue(new Error("Queue down"));
    // processOutbox internally triggers processOutboxRow via drainWorkspaceOutbox
    await service.processOutbox();
    // It should have failed and called db.update to set status: 'RETRY'
    expect(tenantDb.update).toHaveBeenCalled();
    const updateCall = tenantDb.update.mock.calls.find(
      (call: any[]) => call.length > 0,
    );
    expect(updateCall).toBeDefined();
    const setCall = tenantDb
      .update()
      .set.mock.calls.find(
        (call: any[]) =>
          call[0] && typeof call[0] === "object" && "status" in call[0],
      );
    expect(setCall).toBeDefined();
    expect(setCall![0]).toMatchObject({ status: "RETRY" });
  });

  it("processOutboxRow should permanently fail on max attempts", async () => {
    queueService.send.mockRejectedValue(new Error("Queue down"));
    tenantDb.transaction.mockImplementationOnce(async (cb: any) => {
      return cb({
        execute: vi.fn(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi
          .fn()
          .mockResolvedValue([
            { id: "1", traceId: "t1", dataSourceId: "c1", attempts: 6 },
          ]), // Max attempts hit
      });
    });

    await service.processOutbox();
    // It should have called db.update to set status: 'FAIL' and not called queueService.send for the row with attempts: 6
    expect(tenantDb.update).toHaveBeenCalled();
    const setCall = tenantDb
      .update()
      .set.mock.calls.find(
        (call: any[]) =>
          call[0] && typeof call[0] === "object" && "status" in call[0],
      );
    expect(setCall).toBeDefined();
    expect(setCall![0]).toMatchObject({ status: "FAIL" });
    // queueService.send should have been called during the claim phase but rejected, not called again for the failed row
    expect(queueService.send).toHaveBeenCalledWith(expect.anything(), {
      traceId: "t1",
      dataSourceId: "c1",
    });
  });

  it("should handle rejecting drainWorkspace gracefully", async () => {
    const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
    tenantDb.transaction.mockRejectedValueOnce(new Error("db down"));
    // Since mock resolves 2 workspaces ws_1 and ws_2, first throws, second succeeds
    await service.processOutbox();
    // processOutbox handles rejection internally and logs it.
    // Verify that the error was logged
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(
      loggerErrorSpy.mock.calls.some(
        (call: any[]) =>
          typeof call[0] === "string" &&
          call[0].includes("Failed to drain inbound outbox"),
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

  it("should log unexpected rejections if the retry update fails", async () => {
    const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
    queueService.send.mockRejectedValue(new Error("Queue down"));
    tenantDb.update.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error("DB completely dead")),
      }),
    });

    await service.processOutbox();

    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(
      loggerErrorSpy.mock.calls.some(
        (call: any[]) =>
          typeof call[0] === "string" &&
          call[0].includes("Unexpected processOutboxRow failure"),
      ),
    ).toBe(true);
  });
});
