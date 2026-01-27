import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";

export const seedRbac = async (db: NodePgDatabase<typeof schema>) => {
  console.log("Seeding RBAC...");

  // 1. Define Standard Permissions
  // resource:action
  const standardPerms = [
    { id: "users:manage", action: "manage", resource: "users" },
    { id: "users:read", action: "read", resource: "users" },
    { id: "tenants:manage", action: "manage", resource: "tenants" },
    { id: "tenants:read", action: "read", resource: "tenants" },
    { id: "settings:manage", action: "manage", resource: "settings" },
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
      "tenants:manage",
      "tenants:read",
      "settings:manage",
    ],
    admin: ["users:manage", "users:read", "tenants:read", "settings:manage"],
    member: ["users:read"],
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
