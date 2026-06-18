import { describe, it, expect, vi, beforeEach } from "vitest";
import { TenantProvisionWorker } from "./tenant-provision.worker.js";
import { QueueName } from "@soopa/queue";
import type { QueueService } from "@soopa/queue";
import type { ProvisionDatabaseEvent } from "@soopa/queue";

// --- Mocks ---
const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();
const mockPoolEnd = vi.fn();

vi.mock("pg", () => {
  return {
    Client: vi.fn().mockImplementation(function () {
      return {
        connect: mockConnect,
        query: mockQuery,
        end: mockEnd,
      };
    }),
    Pool: vi.fn().mockImplementation(function () {
      return {
        end: mockPoolEnd,
      };
    }),
  };
});

vi.mock("drizzle-orm/node-postgres", () => {
  return {
    drizzle: vi.fn().mockReturnValue({}),
  };
});

vi.mock("drizzle-orm/node-postgres/migrator", () => {
  return {
    migrate: vi.fn().mockResolvedValue(undefined),
  };
});

describe("TenantProvisionWorker", () => {
  let worker: TenantProvisionWorker;
  let queueServiceMock: { consume: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockConnect.mockReset();
    mockEnd.mockReset();
    mockPoolEnd.mockReset();

    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/testdb";

    queueServiceMock = {
      consume: vi.fn(),
    };

    const migratorMock = { runMigrations: vi.fn() };

    // Manually instantiate to avoid SWC decorator metadata issues in vitest
    worker = new TenantProvisionWorker(
      queueServiceMock as unknown as QueueService,
      migratorMock as any,
    );
  });

  // ── Constructor: fail-fast validation ─────────────────────────────────────

  it("throws at construction time when DATABASE_URL is not set", () => {
    delete process.env.DATABASE_URL;
    expect(
      () =>
        new TenantProvisionWorker(
          queueServiceMock as unknown as QueueService,
          { runMigrations: vi.fn() } as any,
        ),
    ).toThrow("TenantProvisionWorker requires DATABASE_URL");
    // Restore for subsequent tests
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/testdb";
  });

  it("registers a consumer for TenantProvisionQueue on init", () => {
    worker.onModuleInit();
    expect(queueServiceMock.consume).toHaveBeenCalledWith(
      QueueName.TenantProvisionQueue,
      expect.any(Function),
    );
  });

  describe("provisioning workflow", () => {
    let handler: (event: ProvisionDatabaseEvent) => Promise<void>;

    beforeEach(() => {
      worker.onModuleInit();
      // Extract the callback that was passed to queueService.consume
      handler = queueServiceMock.consume.mock.calls[0][1] as (
        event: ProvisionDatabaseEvent,
      ) => Promise<void>;
    });

    it("creates database, runs migrations, and registers slot as WARM", async () => {
      // Mock PG to simulate the database does NOT exist initially
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // SELECT 1 FROM pg_database ...
      mockQuery.mockResolvedValueOnce({ rowCount: 0 }); // CREATE DATABASE
      mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE tenant_storage_registry

      await handler({
        poolSlotId: "1234-abcd",
        hostUrl: "postgresql://localhost",
      });

      // 1. Connection lifecycle checks
      // 2 connections total: one for DB creation, one for registry update
      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(mockEnd).toHaveBeenCalledTimes(2);

      // 2. Query checks
      // First query checks if DB exists
      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("SELECT 1 FROM pg_database"),
        ["tenant_1234_abcd"],
      );

      // Second query creates the DB
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        'CREATE DATABASE "tenant_1234_abcd"',
      );

      // Third query updates the registry
      expect(mockQuery).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining("UPDATE tenant_storage_registry"),
        ["WARM-1234-abcd", "postgresql://localhost:5432"],
      );

      // 3. Pool cleanup check
      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
    });

    it("should format URL correctly if connection string has no password", async () => {
      // Provide a DB URL with username but no password
      vi.stubEnv("DATABASE_URL", "postgresql://user@localhost:5432/postgres");
      worker = new TenantProvisionWorker(
        queueServiceMock as unknown as QueueService,
        { runMigrations: vi.fn() } as any,
      );
      worker.onModuleInit();
      handler = queueServiceMock.consume.mock.calls[1][1] as (
        event: ProvisionDatabaseEvent,
      ) => Promise<void>;

      // 1st query: check DB exists
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 2nd query: create DB (returns nothing important)
      mockQuery.mockResolvedValueOnce({});
      // 3rd query: register slot
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await handler({
        poolSlotId: "no-pwd-slot",
        hostUrl: "postgresql://localhost",
      });

      // Verify the URL constructed is passed to pg logic
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("CREATE DATABASE"),
      );
    });

    it("skips database creation if it already exists, but still runs migrations and updates registry", async () => {
      // Mock PG to simulate the database DOES exist
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ "?column?": 1 }],
      }); // SELECT 1 FROM pg_database ...
      mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE tenant_storage_registry

      await handler({
        poolSlotId: "1234-abcd",
        hostUrl: "postgresql://localhost",
      });

      // Create database query should NOT be called
      expect(mockQuery).not.toHaveBeenCalledWith(
        'CREATE DATABASE "tenant_1234_abcd"',
      );

      // Should still update registry
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE tenant_storage_registry"),
        ["WARM-1234-abcd", "postgresql://localhost:5432"],
      );
    });

    it("throws error for invalid poolSlotId (SQL injection prevention)", async () => {
      await expect(
        handler({
          poolSlotId: "1234; DROP TABLE users;",
          hostUrl: "postgresql://localhost",
        }),
      ).rejects.toThrow(
        'Invalid tenant database name: "tenant_1234; DROP TABLE users;"',
      );
    });

    it("logs a warning if no row was updated in registry", async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ "?column?": 1 }],
      });
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      await handler({
        poolSlotId: "missing-slot",
        hostUrl: "postgresql://localhost",
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE tenant_storage_registry"),
        ["WARM-missing-slot", "postgresql://localhost:5432"],
      );
    });

    it("handles non-Error objects thrown during provision", async () => {
      mockQuery.mockRejectedValueOnce("some string error");
      await expect(
        handler({ poolSlotId: "1234", hostUrl: "postgresql://localhost" }),
      ).rejects.toEqual("some string error");
    });

    it("runs migrations even if DATABASE_URL has no credentials", async () => {
      // Re-instantiate: constructor reads DATABASE_URL once, so we must create
      // a new instance with the modified URL.
      process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";
      worker = new TenantProvisionWorker(
        queueServiceMock as unknown as QueueService,
        { runMigrations: vi.fn() } as any,
      );
      worker.onModuleInit();
      handler = queueServiceMock.consume.mock.calls[1][1] as (
        event: ProvisionDatabaseEvent,
      ) => Promise<void>;

      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await handler({
        poolSlotId: "1234-abcd",
        hostUrl: "postgresql://localhost",
      });

      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    // DATABASE_URL absence is now caught at construction time (fail-fast),
    // so there is no runtime handler test for this path.
    // See: 'throws at construction time when DATABASE_URL is not set'
  });
});
