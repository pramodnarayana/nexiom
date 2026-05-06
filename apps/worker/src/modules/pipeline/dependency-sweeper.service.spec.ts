/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from "@nestjs/testing";
import { DependencySweeperService } from "./dependency-sweeper.service.js";
import { QueueService, QueueName } from "@nexiom/queue";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { DB_MANAGER } from "@nexiom/dbmanager";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("DependencySweeperService", () => {
  let service: DependencySweeperService;
  let queueService: any;
  let globalDb: any;
  let tenantDb: any;
  let dbManager: any;

  // Helper to construct a mock database
  function buildDb(staleRecords: any[], replicaRows: any[]) {
    const mockUpdateSet = vi.fn().mockReturnThis();
    const mockUpdateWhere = vi.fn().mockReturnThis();
    const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

    return {
      select: vi.fn().mockImplementation((fields) => {
        // Simple heuristic: if querying replicaEntity (has connectionId), return replicaRows
        if (fields && "connectionId" in fields) {
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue(replicaRows),
          };
        }
        // Otherwise assume outboundGateway
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue(staleRecords),
        };
      }),
      update: mockUpdate,
    };
  }

  beforeEach(async () => {
    queueService = { send: vi.fn() };

    tenantDb = buildDb([{ traceId: "trace-1" }], [{ connectionId: "conn-1" }]);

    dbManager = {
      getTenantDb: vi.fn().mockResolvedValue(tenantDb),
    };

    const mockTenants: any = [{ tenantId: "tenant-1" }];

    const mockConnections: any = {
      from: vi.fn().mockReturnThis(),
      where: vi
        .fn()
        .mockResolvedValue([{ id: "conn-1", appName: "salesforce" }]),
    };

    globalDb = {
      select: vi.fn().mockImplementation((fields) => {
        if (fields && "tenantId" in fields) {
          return {
            from: vi.fn().mockResolvedValue(mockTenants),
          };
        }
        return mockConnections;
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        DependencySweeperService,
        { provide: QueueService, useValue: queueService },
        { provide: DATABASE_CONNECTION, useValue: globalDb },
        { provide: DB_MANAGER, useValue: dbManager },
      ],
    }).compile();

    service = moduleRef.get<DependencySweeperService>(DependencySweeperService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should sweep deferred dependencies and re-queue them", async () => {
    await service.sweepDeferredDependencies();

    expect(queueService.send).toHaveBeenCalledWith(QueueName.NormalizedQueue, {
      traceId: "trace-1",
      connectionId: "conn-1",
    });
    expect(tenantDb.update).toHaveBeenCalled();
  });

  it("should return early if no tenants exist", async () => {
    // Override globalDb to return no tenants
    globalDb.select = vi.fn().mockImplementation((fields) => {
      if (fields && "tenantId" in fields) {
        return { from: vi.fn().mockResolvedValue([]) };
      }
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      };
    });

    await service.sweepDeferredDependencies();
    expect(dbManager.getTenantDb).not.toHaveBeenCalled();
  });

  it("should skip requeue if replica is not found", async () => {
    // Return empty replicaRows
    tenantDb = buildDb([{ traceId: "trace-1" }], []);
    dbManager.getTenantDb.mockResolvedValue(tenantDb);

    await service.sweepDeferredDependencies();

    expect(queueService.send).not.toHaveBeenCalled();
    expect(tenantDb.update).not.toHaveBeenCalled();
  });

  it("should catch and log error if sweeping a tenant throws", async () => {
    dbManager.getTenantDb.mockRejectedValue(new Error("Db connection failed"));

    // Should not throw, should just log error
    await expect(service.sweepDeferredDependencies()).resolves.not.toThrow();
  });

  it("should catch and log critical errors during sweep", async () => {
    // Make the globalDb tenant select throw immediately
    globalDb.select = vi.fn().mockImplementation(() => {
      throw new Error("Critical DB failure");
    });

    await expect(service.sweepDeferredDependencies()).resolves.not.toThrow();
  });
});
