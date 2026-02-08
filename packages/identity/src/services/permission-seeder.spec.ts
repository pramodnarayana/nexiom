import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { PermissionSeeder } from "./permission-seeder";
import { Logger } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";
import { IdentityModuleOptions } from "../identity.module";

type MockDb = {
  insert: Mock;
  values: Mock;
  onConflictDoNothing: Mock;
  execute: Mock;
};

const mkDb = () => {
  const insertMock = vi.fn().mockReturnThis();
  return {
    insert: insertMock,
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  } as unknown as NodePgDatabase<typeof schema> & MockDb;
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
    expect(db.onConflictDoNothing).toHaveBeenCalledTimes(3);

    // Verify rolePermission onConflict target (3rd call)
    // The calls are likely: 1. role, 2. permission, 3. rolePermission
    const onConflictCalls = db.onConflictDoNothing.mock.calls;
    const lastCall = onConflictCalls[2];
    expect(lastCall[0]).toEqual({
      target: [
        schema.rolePermission.roleId,
        schema.rolePermission.permissionId,
        schema.rolePermission.organizationId,
      ],
    });

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
});
