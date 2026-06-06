import { describe, it, expect, vi } from "vitest";
import { seedSystemRbac } from "./rbac-seeding.js";
import type { IRbacRepository } from "./rbac-seeding.js";
import { ALL_PERMISSIONS } from "../constants.js";

class FakeRbacRepository implements IRbacRepository {
  public insertedRoles: {
    id: string;
    name: string;
    isSystem: boolean;
    description: string;
    createdAt: Date;
  }[] = [];
  public insertedPermissions: {
    id: string;
    resource: string;
    action: string;
    createdAt: Date;
  }[] = [];
  public insertedRolePermissions: {
    id: string;
    roleId: string;
    permissionId: string;
    organizationId: string | null;
  }[] = [];
  public existingRolePermissions: string[] = [];

  ensureRoles(
    roles: {
      id: string;
      name: string;
      isSystem: boolean;
      description: string;
      createdAt: Date;
    }[],
  ): Promise<void> {
    this.insertedRoles.push(...roles);
    return Promise.resolve();
  }

  ensurePermissions(
    permissions: {
      id: string;
      resource: string;
      action: string;
      createdAt: Date;
    }[],
  ): Promise<void> {
    this.insertedPermissions.push(...permissions);
    return Promise.resolve();
  }

  getExistingRolePermissions(
    _roleIds: string[],
  ): Promise<
    { roleId: string; permissionId: string; organizationId: string | null }[]
  > {
    return Promise.resolve(
      this.existingRolePermissions
        .map((item) => {
          const [roleId, permissionId, organizationId] = item.split("|");
          return {
            roleId: roleId,
            permissionId: permissionId,
            organizationId:
              organizationId === "__NULL__" ? null : organizationId,
          };
        })
        .filter((mapping) => _roleIds.includes(mapping.roleId)),
    );
  }

  insertRolePermissions(
    rolePermissions: {
      id: string;
      roleId: string;
      permissionId: string;
      organizationId: string | null;
    }[],
  ): Promise<void> {
    this.insertedRolePermissions.push(...rolePermissions);
    return Promise.resolve();
  }

  transaction<T>(cb: (repo: IRbacRepository) => Promise<T>): Promise<T> {
    return cb(this);
  }
}

describe("seedSystemRbac", () => {
  const config = {
    ownerRoleId: "r-owner",
    adminRoleId: "r-admin",
    memberRoleId: "r-member",
    systemTenantId: "sys-tenant",
  };

  const mockLogger = { log: vi.fn(), error: vi.fn() };

  it("throws an error if role IDs are not distinct", async () => {
    const repo = new FakeRbacRepository();
    await expect(
      seedSystemRbac(
        repo,
        { ...config, adminRoleId: "r-owner" },
        mockLogger as unknown as Console,
      ),
    ).rejects.toThrow("Duplicate Role IDs detected");
  });

  it("seeds roles, permissions, and role-permissions correctly", async () => {
    const repo = new FakeRbacRepository();
    await seedSystemRbac(repo, config, mockLogger as unknown as Console);

    expect(repo.insertedRoles).toHaveLength(3);
    expect(repo.insertedRoles.map((r) => r.name)).toEqual([
      "owner",
      "admin",
      "member",
    ]);

    expect(repo.insertedPermissions).toHaveLength(ALL_PERMISSIONS.length);

    // Check that it filtered out duplicates. By default, with no existing permissions, it inserts all mapped perms.
    expect(repo.insertedRolePermissions.length).toBeGreaterThan(0);

    // Admin gets all perms, some are system (sys-tenant), some are non-system (null)
    const adminPerms = repo.insertedRolePermissions.filter(
      (rp) => rp.roleId === "r-admin",
    );
    expect(adminPerms).toHaveLength(ALL_PERMISSIONS.length);
    expect(adminPerms.some((rp) => rp.organizationId === "sys-tenant")).toBe(
      true,
    );
    expect(adminPerms.some((rp) => rp.organizationId === null)).toBe(true);
  });

  it("avoids inserting existing role permissions", async () => {
    const repo = new FakeRbacRepository();
    // Simulate that the admin role already has 'users:read' (which is non-system, so org is null)
    repo.existingRolePermissions = ["r-admin|users:read|__NULL__"];

    await seedSystemRbac(repo, config, mockLogger as unknown as Console);

    const adminPerms = repo.insertedRolePermissions.filter(
      (rp) => rp.roleId === "r-admin",
    );
    expect(adminPerms.length).toBe(ALL_PERMISSIONS.length - 1);
    expect(adminPerms.some((rp) => rp.permissionId === "users:read")).toBe(
      false,
    );
  });
});
