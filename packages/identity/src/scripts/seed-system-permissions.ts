import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";
import { role, permission, rolePermission } from "../schema";
import { eq } from "drizzle-orm";

export async function seedOwnerPermissions(db: NodePgDatabase<typeof schema>) {
  const ALLOWED_ENVS = ["development", "test", "local"];
  const env = process.env.NODE_ENV;
  if (!env || !ALLOWED_ENVS.includes(env)) {
    throw new Error(
      `🛑 Seeding is not allowed in '${env || "unset"}' environment`,
    );
  }

  console.log("Seeding Owner Permissions...");

  // 1. Ensure 'all:manage' permission exists
  const [manageAll] = await db
    .insert(permission)
    .values({
      id: "all:manage",
      resource: "all",
      action: "manage",
      description: "Super Admin Access",
    })
    .onConflictDoNothing()
    .returning();

  // 2. Get Owner Role
  const [ownerRole] = await db
    .select()
    .from(role)
    .where(eq(role.name, "Owner"));

  if (ownerRole) {
    // 3. Assign Permission to Role
    // We need the permission ID. If it was just inserted, use it. If not, fetch it.
    let permissionId = manageAll?.id;
    if (!permissionId) {
      const [existing] = await db
        .select()
        .from(permission)
        .where(eq(permission.id, "all:manage"));
      permissionId = existing?.id;
    }

    if (permissionId) {
      await db
        .insert(rolePermission)
        .values({
          id: `rp_${ownerRole.id}_${permissionId}`,
          roleId: ownerRole.id,
          permissionId: permissionId,
        })
        .onConflictDoNothing();
      console.log("Owner role granted all:manage");
    }
  } else {
    console.error("Owner role not found! Please seed roles first.");
  }
}
