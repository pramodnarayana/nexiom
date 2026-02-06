/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PermissionSeeder } from "./permission-seeder";
import { Logger } from "@nestjs/common";

const mkDb = () => {
  return {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    execute: vi.fn(),
  };
};

const mkOptions = () => ({
  constants: {
    systemTenantId: "sys",
    ownerRoleId: "owner",
    adminRoleId: "admin",
    memberRoleId: "member",
  },
});

describe("PermissionSeeder", () => {
  let db: any;
  let seeder: PermissionSeeder;
  let options: any;

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
    expect(db.insert).toHaveBeenCalled();
    expect(db.onConflictDoNothing).toHaveBeenCalled();
  });

  it("handles errors gracefully", async () => {
    db.insert.mockImplementation(() => {
      throw new Error("DB Error");
    });
    const logSpy = vi.spyOn(Logger.prototype, "error");
    await seeder.seed();
    expect(logSpy).toHaveBeenCalledWith(
      "Failed to seed RBAC",
      expect.any(Error),
    );
  });
});
