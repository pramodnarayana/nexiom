import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import * as schema from "../schema";
import {
  ALL_PERMISSIONS,
  isSystemPermission,
  PermissionType,
} from "../constants";

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

    const addPermissionsForRole = (
      roleId: string,
      permissions: readonly string[],
      scopedOrganizationId: string,
    ) => {
      for (const p of permissions) {
        // Deterministically decide scope based on permission type
        const isSystem = isSystemPermission(p);
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
    // Member role always receives organizationId: null per RBAC design (see ADR)
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

    // 3. Assign Permissions (Read-Filter-Insert to avoid ON CONFLICT issues)
    if (rolePermissionsToInsert.length > 0) {
      // Fetch existing to dedupe in memory
      const existing = await db
        .select({
          roleId: schema.rolePermission.roleId,
          permissionId: schema.rolePermission.permissionId,
          organizationId: schema.rolePermission.organizationId,
        })
        .from(schema.rolePermission);

      const existingSet = new Set(
        existing.map(
          (e) =>
            `${e.roleId}|${e.permissionId}|${e.organizationId ?? "__NULL__"}`,
        ),
      );

      const toInsert = rolePermissionsToInsert.filter((rp) => {
        const key = `${rp.roleId}|${rp.permissionId}|${rp.organizationId ?? "__NULL__"}`;
        if (existingSet.has(key)) {
          return false;
        }
        // Also dedupe internally within the batch
        existingSet.add(key);
        return true;
      });

      if (toInsert.length > 0) {
        // Batch insert in chunks if needed, but Drizzle handles it reasonably
        await db.insert(schema.rolePermission).values(toInsert);
        logger.log(`Inserted ${toInsert.length} new role permissions.`);
      } else {
        logger.log("No new role permissions to insert.");
      }
    }

    logger.log("RBAC Seeding Complete (Canonical)");
  } catch (error) {
    logger.error("Failed to seed RBAC", error);
    throw error;
  }
}
