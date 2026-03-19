/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { PermissionSeeder } from "./permission-seeder.js";
import { Logger } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { IdentityModuleOptions } from "../identity.module.js";

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
    transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(db)),
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

  it("onModuleInit always calls seed", async () => {
    const spy = vi.spyOn(seeder, "seed").mockResolvedValue(undefined);
    await seeder.onModuleInit();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("onModuleInit re-throws seed errors after logging", async () => {
    const err = new Error("DB Error");
    vi.spyOn(seeder, "seed").mockRejectedValue(err);
    const logSpy = vi.spyOn(Logger.prototype, "error");
    await expect(seeder.onModuleInit()).rejects.toThrow("DB Error");
    expect(logSpy).toHaveBeenCalledWith("Failed to seed RBAC data", err);
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
    expect(roleValues?.find((r) => r.name === "owner")).toBeDefined();

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
    vi.doMock("../constants.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../constants.js")>();
      return {
        ...actual,
        // Include all permissions referenced by the member role in rbac-seeding
        ALL_PERMISSIONS: [
          "users:read",
          "tenants:read",
          "dashboard:read",
          "workspaces:read",
          "admin_dashboard:view",
          "system_users:read",
          "system_tenants:read",
        ],
        isSystemPermission: (p: string) =>
          p.startsWith("system_") || p.startsWith("admin_dashboard:"),
      };
    });

    try {
      // Re-import to pickup mock
      const { seedSystemRbac } = await import("../utils/rbac-seeding.js");

      const dbMock = mkDb();

      // Return existing rows covering every permission that seedSystemRbac would generate
      // for owner, admin, and member roles so the deduplication sees them all as existing.
      const existingRows = [
        // member base perms (organizationId: null)
        { roleId: "member", permissionId: "users:read", organizationId: null },
        {
          roleId: "member",
          permissionId: "tenants:read",
          organizationId: null,
        },
        {
          roleId: "member",
          permissionId: "dashboard:read",
          organizationId: null,
        },
        {
          roleId: "member",
          permissionId: "workspaces:read",
          organizationId: null,
        },
        // member system perms (organizationId: "sys")
        {
          roleId: "member",
          permissionId: "admin_dashboard:view",
          organizationId: "sys",
        },
        {
          roleId: "member",
          permissionId: "system_users:read",
          organizationId: "sys",
        },
        {
          roleId: "member",
          permissionId: "system_tenants:read",
          organizationId: "sys",
        },
        // admin & owner — all perms (null + sys scoped)
        ...["admin", "owner"].flatMap((role) => [
          { roleId: role, permissionId: "users:read", organizationId: null },
          { roleId: role, permissionId: "tenants:read", organizationId: null },
          {
            roleId: role,
            permissionId: "dashboard:read",
            organizationId: null,
          },
          {
            roleId: role,
            permissionId: "workspaces:read",
            organizationId: null,
          },
          {
            roleId: role,
            permissionId: "admin_dashboard:view",
            organizationId: "sys",
          },
          {
            roleId: role,
            permissionId: "system_users:read",
            organizationId: "sys",
          },
          {
            roleId: role,
            permissionId: "system_tenants:read",
            organizationId: "sys",
          },
        ]),
      ];
      dbMock.select.mockReturnValue(mockChainedQuery(existingRows));

      const loggerMock = { log: vi.fn(), error: vi.fn() } as unknown as Logger;
      const optionsMock = mkOptions();

      await seedSystemRbac(dbMock, optionsMock.constants, loggerMock);

      expect(loggerMock.log).toHaveBeenCalledWith(
        "No new role permissions to insert.",
      );
    } finally {
      vi.doUnmock("../constants.js");
    }
  });

  it("seed throws error on invalid permission format", async () => {
    vi.resetModules();
    vi.doMock("../constants.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../constants.js")>();
      return {
        ...actual,
        ALL_PERMISSIONS: ["invalid-format"],
      };
    });

    try {
      const { seedSystemRbac } = await import("../utils/rbac-seeding.js");
      const dbMock = mkDb();
      const loggerMock = { log: vi.fn(), error: vi.fn() } as unknown as Logger;
      const optionsMock = mkOptions();

      await expect(
        seedSystemRbac(dbMock, optionsMock.constants, loggerMock),
      ).rejects.toThrow("Invalid permission format: invalid-format");
    } finally {
      vi.doUnmock("../constants.js");
    }
  });
});
