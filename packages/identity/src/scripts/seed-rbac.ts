import { v4 as uuidv4 } from "uuid";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";
import {
  getOwnerRoleId,
  getAdminRoleId,
  getMemberRoleId,
  ALL_PERMISSIONS,
} from "../constants";

export const seedRbac = async (db: NodePgDatabase<typeof schema>) => {
  console.log("Seeding RBAC...");

  if (!getOwnerRoleId() || !getAdminRoleId() || !getMemberRoleId()) {
    throw new Error(
      "Missing required RBAC Role IDs (OWNER_ROLE_ID, ADMIN_ROLE_ID, MEMBER_ROLE_ID)",
    );
  }

  const ownerRoleId = getOwnerRoleId();
  const adminRoleId = getAdminRoleId();
  const memberRoleId = getMemberRoleId();

  // Validate uniqueness
  const roleIds = [ownerRoleId, adminRoleId, memberRoleId];
  if (new Set(roleIds).size !== 3) {
    throw new Error(
      "OWNER_ROLE_ID, ADMIN_ROLE_ID, and MEMBER_ROLE_ID must be unique",
    );
  }

  // 1. Define Standard Permissions
  // resource:action
  // Strictly granular for PBAC strategies
  const standardPerms = ALL_PERMISSIONS.map((p) => {
    const [resource, action] = p.split(":");
    return {
      id: p,
      action,
      resource,
    };
  });

  await db
    .insert(schema.permission)
    .values(standardPerms)
    .onConflictDoNothing();

  // 2. Define Standard Roles
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
      description: "Read-only access",
    },
  ];

  await db.insert(schema.role).values(roles).onConflictDoNothing();

  // 3. Assign Permissions to Roles
  // Map role -> permission[]
  const roleMap: Record<string, string[]> = {
    [ownerRoleId]: [
      "dashboard:read",
      "users:manage",
      "users:read",
      "users:create",
      "users:update",
      "users:delete",
      "tenants:manage",
      "tenants:read",
      "tenants:create",
      "tenants:update",
      "tenants:delete",
      "settings:manage",
      "settings:read",
    ],
    [adminRoleId]: [
      "dashboard:read",
      "users:manage",
      "users:read",
      "users:create",
      "users:update",
      "users:delete",
      "tenants:read",
      "settings:manage",
      "settings:read",
    ],
    [memberRoleId]: ["users:read", "tenants:read"],
  };

  const rolePermsToInsert: {
    id: string;
    roleId: string;
    permissionId: string;
  }[] = [];

  for (const [roleId, permIds] of Object.entries(roleMap)) {
    for (const permId of permIds) {
      rolePermsToInsert.push({ id: uuidv4(), roleId, permissionId: permId });
    }
  }

  await db
    .insert(schema.rolePermission)
    .values(rolePermsToInsert)
    .onConflictDoNothing();

  console.log("RBAC Seeding Complete.");
};
