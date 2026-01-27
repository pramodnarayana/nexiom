import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";

export const seedRbac = async (db: NodePgDatabase<typeof schema>) => {
  console.log("Seeding RBAC...");

  // 1. Define Standard Permissions
  // resource:action
  // Strictly granular for PBAC strategies
  const standardPerms = [
    // Users
    { id: "users:read", action: "read", resource: "users" },
    { id: "users:create", action: "create", resource: "users" },
    { id: "users:update", action: "update", resource: "users" },
    { id: "users:delete", action: "delete", resource: "users" },
    { id: "users:manage", action: "manage", resource: "users" },

    // Tenants
    { id: "tenants:read", action: "read", resource: "tenants" },
    { id: "tenants:create", action: "create", resource: "tenants" },
    { id: "tenants:update", action: "update", resource: "tenants" },
    { id: "tenants:delete", action: "delete", resource: "tenants" },
    { id: "tenants:manage", action: "manage", resource: "tenants" },

    // Dashboard
    { id: "dashboard:view", action: "view", resource: "dashboard" },

    // Settings
    { id: "settings:manage", action: "manage", resource: "settings" },
    { id: "settings:read", action: "read", resource: "settings" },
  ];

  await db
    .insert(schema.permission)
    .values(standardPerms)
    .onConflictDoNothing();

  // 2. Define Standard Roles
  const roles = [
    { id: "owner", name: "Owner", isSystem: true, description: "Full access" },
    {
      id: "admin",
      name: "Admin",
      isSystem: true,
      description: "Manage users and settings",
    },
    {
      id: "member",
      name: "Member",
      isSystem: true,
      description: "Read-only access",
    },
  ];

  await db.insert(schema.role).values(roles).onConflictDoNothing();

  // 3. Assign Permissions to Roles
  // Map role -> permission[]
  const roleMap: Record<string, string[]> = {
    owner: [
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
    admin: [
      "users:manage",
      "users:read",
      "users:create",
      "users:update",
      "users:delete",
      "tenants:read",
      "settings:manage",
      "settings:read",
    ],
    member: ["users:read", "tenants:read"],
  };

  const rolePermsToInsert: { roleId: string; permissionId: string }[] = [];

  for (const [roleId, permIds] of Object.entries(roleMap)) {
    for (const permId of permIds) {
      rolePermsToInsert.push({ roleId, permissionId: permId });
    }
  }

  await db
    .insert(schema.rolePermission)
    .values(rolePermsToInsert)
    .onConflictDoNothing();

  console.log("RBAC Seeding Complete.");
};
