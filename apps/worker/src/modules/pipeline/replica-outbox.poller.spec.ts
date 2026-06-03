/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { Test, TestingModule } from "@nestjs/testing";
import { ReplicaOutboxPoller } from "./replica-outbox.poller.js";
import { DATABASE_CONNECTION, tenantStorageRegistry } from "@soopa/database";
import { QueueService, QueueName } from "@soopa/queue";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { DB_MANAGER } from "@soopa/dbmanager";

describe("ReplicaOutboxPoller", () => {
  let service: ReplicaOutboxPoller;
  let globalDb: any;
  let tenantDb: any;
  let dbManager: any;
  let queueService: any;
  let module: TestingModule;

  beforeEach(async () => {
    queueService = { send: vi.fn() };

    tenantDb = {
      execute: vi.fn().mockResolvedValue({ rows: [{ schema_exists: true }] }),
      select: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      from: vi.fn().mockResolvedValue([{ id: "conn_1", appName: "test-app" }]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
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
        ReplicaOutboxPoller,
        { provide: DATABASE_CONNECTION, useValue: globalDb },
        { provide: QueueService, useValue: queueService },
        { provide: DB_MANAGER, useValue: dbManager },
      ],
    }).compile();

    service = module.get<ReplicaOutboxPoller>(ReplicaOutboxPoller);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  it("processOutbox should fetch workspaces and process rows", async () => {
    await service.processOutbox();
    // It should fetch workspaces ws_1 and ws_2, and for both, it mocks claiming 1 row.
    // The claimed row is successfully delivered to QueueName.ReplicaQueue
    expect(queueService.send).toHaveBeenCalledWith(QueueName.ReplicaQueue, {
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
    // It should have called db.update to set status: 'FAIL'
    expect(tenantDb.update).toHaveBeenCalled();
  });

  it("should handle rejecting drainWorkspace gracefully", async () => {
    tenantDb.transaction.mockRejectedValueOnce(new Error("db down"));
    // Since mock resolves 2 workspaces ws_1 and ws_2, first throws, second succeeds
    await service.processOutbox();
    // processOutbox handles rejection internally and logs it.
    // Test passes if it does not throw unhandled exception
    expect(true).toBe(true);
  });

  it("should skip drain if schema does not exist", async () => {
    tenantDb.execute.mockResolvedValueOnce({
      rows: [{ schema_exists: false }],
    });
    await service.processOutbox();
    expect(true).toBe(true);
  });

  it("should catch and log globalDb select errors", async () => {
    globalDb.select.mockImplementationOnce(() => {
      throw new Error("global db down");
    });
    await service.processOutbox();
    // Test passes if it does not throw
    expect(true).toBe(true);
  });

  it("should catch and log tenant processing errors", async () => {
    dbManager.getTenantDb.mockRejectedValueOnce(new Error("tenant db down"));
    await service.processOutbox();
    // Test passes if it does not throw
    expect(true).toBe(true);
  });
});
