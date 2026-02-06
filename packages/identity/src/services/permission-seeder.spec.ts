import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
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
  return {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    execute: vi.fn(),
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

  it("onModuleInit calls seed", async () => {
    const spy = vi.spyOn(seeder, "seed").mockResolvedValue(undefined);
    await seeder.onModuleInit();
    expect(spy).toHaveBeenCalled();
  });

  it("seed inserts roles, permissions, and rolePermissions", async () => {
    await seeder.seed();
    // Roles (3) + Permissions (19) + RolePermissions (many)
    expect(db.insert).toHaveBeenCalledTimes(3);

    // Check Roles insert

    // const rolesCall = db.insert.mock.calls[0]; // First call
    // We can't easily check args if the mock chain is complex (insert -> values)
    // But we CAN check values() calls if we spy on the chain return.

    expect(db.values).toHaveBeenCalledTimes(3);

    const roleValues = db.values.mock.calls[0][0] as Record<string, unknown>[];
    expect(roleValues).toHaveLength(3);
    expect(roleValues.find((r) => r.name === "Owner")).toBeDefined();

    const permValues = db.values.mock.calls[1][0] as Record<string, unknown>[];
    expect(permValues.length).toBeGreaterThan(10);
    expect(permValues[0]).toHaveProperty("resource");

    // 3. Role Permissions
    const rolePermValues = db.values.mock.calls[2][0] as Record<
      string,
      unknown
    >[];
    expect(rolePermValues.length).toBeGreaterThan(10);
    // Verify Member permissions exist
    expect(rolePermValues.find((rp) => rp.roleId === "member")).toBeDefined();

    expect(db.onConflictDoNothing).toHaveBeenCalledTimes(3);
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
