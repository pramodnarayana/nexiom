/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { PermissionSeeder } from "./permission-seeder";
import { Logger } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";
import { IdentityModuleOptions } from "../identity.module";

// Mock constants removed (using vi.doMock in test instead)

type MockDb = {
  insert: Mock;
  values: Mock;
  onConflictDoNothing: Mock;
  execute: Mock;
  select: Mock;
};

const mockChainedQuery = (result: unknown) => {
  const chain: Record<string, any> = {
    then: (onfulfilled: (value: unknown) => unknown) =>
      Promise.resolve(result).then(onfulfilled),
  };
  const methods = ["from", "where", "innerJoin", "select", "limit", "offset"];
  methods.forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  return chain;
};

const mkDb = () => {
  const insertMock = vi.fn().mockReturnThis();
  const db = {
    insert: insertMock,
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(),
    query: {
      organization: { findFirst: vi.fn().mockResolvedValue({ id: "sys" }) },
      rolePermission: { findMany: vi.fn().mockResolvedValue([]) },
    },
  } as unknown as NodePgDatabase<typeof schema> & MockDb;

  // Mock data for select (RolePermissions) to allow rolePermission seeding AND test deduplication
  db.select.mockReturnValue(
    mockChainedQuery([
      // This should match one of the generated permissions for Member role
      { roleId: "member", permissionId: "users:read", organizationId: null },
    ]),
  );
  return db;
};

const mkOptions = (): IdentityModuleOptions =>
  ({
    constants: {
      systemTenantId: "sys",
      ownerRoleId: "owner",
      adminRoleId: "admin",
      memberRoleId: "member",
    },
  }) as IdentityModuleOptions;

describe("PermissionSeeder", () => {
  let db: NodePgDatabase<typeof schema> & MockDb;
  let seeder: PermissionSeeder;

  let options: IdentityModuleOptions;

  beforeEach(() => {
    db = mkDb();
    options = mkOptions();
    seeder = new PermissionSeeder(db, options);
    // Suppress logs
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("onModuleInit calls seed if no permissions exist", async () => {
    // Mock db.query.rolePermission to return empty (triggering seed)
    db.query = {
      rolePermission: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as typeof db.query;
    const spy = vi.spyOn(seeder, "seed").mockResolvedValue(undefined);
    await seeder.onModuleInit();
    expect(spy).toHaveBeenCalled();
  });

  it("onModuleInit skips seed if permissions exist", async () => {
    // Mock db.query.rolePermission to return data (skipping seed)
    db.query = {
      rolePermission: { findMany: vi.fn().mockResolvedValue([{ id: "1" }]) },
    } as unknown as typeof db.query;
    const seedSpy = vi.spyOn(seeder, "seed");
    const logSpy = vi.spyOn(Logger.prototype, "log");

    await seeder.onModuleInit();

    expect(seedSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      "RBAC data already exists, skipping seed",
    );
  });

  it("seed inserts roles, permissions, and rolePermissions", async () => {
    await seeder.seed();
    // Roles (3) + Permissions (19) + RolePermissions (many)
    expect(db.insert).toHaveBeenCalledTimes(3);

    // Check Roles insert

    // Find calls by content shape
    const calls = db.values.mock.calls.map(
      (c) => c[0] as Record<string, unknown>[],
    );

    // 1. Roles: should have 'name' property
    const roleValues = calls.find(
      (rows) => rows.length > 0 && "name" in rows[0],
    );
    expect(roleValues).toBeDefined();
    expect(roleValues).toHaveLength(3);
    expect(roleValues?.find((r) => r.name === "Owner")).toBeDefined();

    // 2. Permissions: should have 'resource' property
    const permValues = calls.find(
      (rows) => rows.length > 0 && "resource" in rows[0],
    );
    expect(permValues).toBeDefined();
    expect(permValues?.length).toBeGreaterThan(10);

    // 3. Role Permissions: should have 'roleId' property
    const rolePermValues = calls.find(
      (rows) => rows.length > 0 && "roleId" in rows[0],
    );
    expect(rolePermValues).toBeDefined();
    expect(rolePermValues?.length).toBeGreaterThan(10);
    // Verify Member permissions exist
    expect(rolePermValues?.find((rp) => rp.roleId === "member")).toBeDefined();

    // Validate insert() was called with correct table schemas
    expect(db.insert).toHaveBeenCalledWith(schema.role);
    expect(db.insert).toHaveBeenCalledWith(schema.permission);
    expect(db.insert).toHaveBeenCalledWith(schema.rolePermission);
    expect(db.onConflictDoNothing).toHaveBeenCalledTimes(2);

    // Verify rolePermission insert (which does NOT use onConflictDoNothing in rbac-seeding.ts)
    // It manually filters and inserts
    const rolePermissionInsertCall = db.values.mock.calls.find(
      (args) =>
        args[0] &&
        Array.isArray(args[0]) &&
        args[0].length > 0 &&
        "roleId" in args[0][0],
    );
    expect(rolePermissionInsertCall).toBeDefined();
    expect(db.insert).toHaveBeenCalledWith(schema.rolePermission);

    // Assert scoping (User requested check for sys vs null orgId)
    // Reuse rolePermValues from above

    // Check for at least one system-scoped permission (admin_dashboard:view or system_*)
    const systemScoped = rolePermValues?.find(
      (rp) => rp.organizationId === "sys", // systemTenantId from mock
    );
    expect(systemScoped).toBeDefined();
    expect(systemScoped?.organizationId).toBe("sys");

    // Check for at least one global permission
    const globalScoped = rolePermValues?.find(
      (rp) => rp.organizationId === null,
    );
    expect(globalScoped).toBeDefined();
    expect(globalScoped?.organizationId).toBeNull();
  });

  it("handles errors gracefully", async () => {
    db.insert.mockImplementation(() => {
      throw new Error("DB Error");
    });
    const logSpy = vi.spyOn(Logger.prototype, "error");
    await expect(seeder.seed()).rejects.toThrow("DB Error");
    expect(logSpy).toHaveBeenCalledWith(
      "Failed to seed RBAC",
      expect.any(Error),
    );
  });

  it("seed skips rolePermission insertion if all exist", async () => {
    vi.resetModules();
    vi.doMock("../constants", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../constants")>();
      return {
        ...actual,
        ALL_PERMISSIONS: ["users:read"],
        isSystemPermission: () => false,
      };
    });

    // Re-import to pickup mock
    const { seedSystemRbac } = await import("../utils/rbac-seeding");

    // We need a fresh db mock because mkDb is defined in this file but we need to pass it to seedSystemRbac
    const db = mkDb();

    // Mock select to return the EXISTING token matching "users:read" for all roles
    db.select.mockReturnValue(
      mockChainedQuery([
        { roleId: "member", permissionId: "users:read", organizationId: null },
        { roleId: "admin", permissionId: "users:read", organizationId: null },
        { roleId: "owner", permissionId: "users:read", organizationId: null },
      ]),
    );

    const logger = { log: vi.fn(), error: vi.fn() } as unknown as Logger;
    const options = mkOptions();

    await seedSystemRbac(db, options.constants, logger);

    expect(logger.log).toHaveBeenCalledWith(
      "No new role permissions to insert.",
    );

    vi.doUnmock("../constants");
  });

  it("seed throws error on invalid permission format", async () => {
    vi.resetModules();
    vi.doMock("../constants", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../constants")>();
      return {
        ...actual,
        ALL_PERMISSIONS: ["invalid-format"],
      };
    });

    const { seedSystemRbac } = await import("../utils/rbac-seeding");
    const db = mkDb();
    const logger = { log: vi.fn(), error: vi.fn() } as unknown as Logger;
    const options = mkOptions();

    await expect(seedSystemRbac(db, options.constants, logger)).rejects.toThrow(
      "Invalid permission format: invalid-format",
    );

    vi.doUnmock("../constants");
  });
});
