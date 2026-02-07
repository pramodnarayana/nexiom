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

  // 0. Validate Config
  if (new Set([ownerRoleId, adminRoleId, memberRoleId]).size !== 3) {
    throw new Error(
      `Duplicate Role IDs detected: Owner=${ownerRoleId}, Admin=${adminRoleId}, Member=${memberRoleId}. Roles must be distinct.`,
    );
  }

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

    const addPermissionsForRole = (
      roleId: string,
      permissions: readonly string[],
      scopedOrganizationId: string,
    ) => {
      for (const p of permissions) {
        // Deterministically decide scope based on permission type
        const isSystem = isSystemPerm(p);
        const orgId = isSystem ? scopedOrganizationId : null;

        // Push to list
        rolePermissionsToInsert.push({
          id: uuidv4(),
          roleId,
          permissionId: p,
          organizationId: orgId,
        });
      }
    };

    // Admin
    addPermissionsForRole(adminRoleId, perms, systemTenantId);

    // Member: curated safe subset
    const memberPerms: PermissionType[] = ["users:read", "tenants:read"];
    // Member permissions are global for non-system perms in this context,
    // but member logic in original was: "null" for everything.
    // Original logic:
    // memberPerms.forEach((p) => {
    //   if (perms.includes(p)) {
    //       rolePermissionsToInsert.push({ ..., organizationId: null });
    //   }
    // });
    // This helper logic (isSystem ? sys : null) works for member too
    // IF member perms are NOT system perms and we pass systemTenantId.
    // However, member perms "users:read" and "tenants:read" are not "system_" perms,
    // so they will be null.
    // But if we ever add a system perm to member, it would get system scope.
    // Let's use a simpler loop for member to match exact original "always null" behavior if needed,
    // OR just use the helper if we trust the "isSystem" logic.
    // The original code used `organizationId: null` hardcoded for Member.
    // Let's stick to safe iteration for member to avoid accidental system grant.
    for (const p of memberPerms) {
      if (perms.includes(p)) {
        rolePermissionsToInsert.push({
          id: uuidv4(),
          roleId: memberRoleId,
          permissionId: p,
          organizationId: null,
        });
      }
    }

    // Owner (Same as Admin)
    addPermissionsForRole(ownerRoleId, perms, systemTenantId);

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
