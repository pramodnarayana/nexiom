import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import * as schema from "../schema";
import { ALL_PERMISSIONS, PermissionType } from "../constants";

export interface RbacConfig {
  ownerRoleId: string;
  adminRoleId: string;
  memberRoleId: string;
  systemTenantId: string;
}

export async function seedSystemRbac(
  db: NodePgDatabase<typeof schema>,
  config: RbacConfig,
  logger: Logger | Console = console,
) {
  logger.log("Checking RBAC consistency (Canonical)...");
  const { ownerRoleId, adminRoleId, memberRoleId, systemTenantId } = config;
  const now = new Date();

  try {
    // 1. Ensure Roles
    const roles = [
      {
        id: ownerRoleId,
        name: "Owner",
        isSystem: true,
        description: "Full access",
      },
      {
        id: adminRoleId,
        name: "Admin",
        isSystem: true,
        description: "Manage users and settings",
      },
      {
        id: memberRoleId,
        name: "Member",
        isSystem: true,
        description: "Read only access",
      },
    ];

    await db
      .insert(schema.role)
      .values(
        roles.map((r) => ({
          ...r,
          createdAt: now,
        })),
      )
      .onConflictDoNothing();

    // 2. Ensure Permissions
    const perms = ALL_PERMISSIONS;
    const permissionsToInsert = perms.map((p) => {
      const separatorIndex = p.indexOf(":");
      if (separatorIndex === -1) {
        throw new Error(`Invalid permission format: ${p}`);
      }
      return {
        id: p,
        resource: p.substring(0, separatorIndex),
        action: p.substring(separatorIndex + 1),
        createdAt: now,
      };
    });

    await db
      .insert(schema.permission)
      .values(permissionsToInsert)
      .onConflictDoNothing();

    // 3. Assign Permissions
    const rolePermissionsToInsert: {
      id: string;
      roleId: string;
      permissionId: string;
      organizationId?: string | null;
    }[] = [];

    const isSystemPerm = (p: string) =>
      p.startsWith("system_") || p === "admin_dashboard:view";

    // Admin: Split assignments
    const adminGlobal = perms.filter((p) => !isSystemPerm(p));
    adminGlobal.forEach((p) =>
      rolePermissionsToInsert.push({
        id: uuidv4(),
        roleId: adminRoleId,
        permissionId: p,
        organizationId: null,
      }),
    );

    const adminSystem = perms.filter(isSystemPerm);
    adminSystem.forEach((p) =>
      rolePermissionsToInsert.push({
        id: uuidv4(),
        roleId: adminRoleId,
        permissionId: p,
        organizationId: systemTenantId,
      }),
    );

    // Member: curated safe subset
    const memberPerms: PermissionType[] = ["users:read", "tenants:read"];
    memberPerms.forEach((p) => {
      if (perms.includes(p)) {
        rolePermissionsToInsert.push({
          id: uuidv4(),
          roleId: memberRoleId,
          permissionId: p,
          organizationId: null,
        });
      }
    });

    // Owner: Split assignments (same as admin)
    const ownerGlobal = perms.filter((p) => !isSystemPerm(p));
    ownerGlobal.forEach((p) =>
      rolePermissionsToInsert.push({
        id: uuidv4(),
        roleId: ownerRoleId,
        permissionId: p,
        organizationId: null,
      }),
    );

    const ownerSystem = perms.filter(isSystemPerm);
    ownerSystem.forEach((p) =>
      rolePermissionsToInsert.push({
        id: uuidv4(),
        roleId: ownerRoleId,
        permissionId: p,
        organizationId: systemTenantId,
      }),
    );

    await db
      .insert(schema.rolePermission)
      .values(rolePermissionsToInsert)
      .onConflictDoNothing({
        target: [
          schema.rolePermission.roleId,
          schema.rolePermission.permissionId,
          schema.rolePermission.organizationId,
        ],
      });

    logger.log("RBAC Seeding Complete (Canonical)");
  } catch (error) {
    logger.error("Failed to seed RBAC", error);
    throw error;
  }
}
