import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";
import {
  IPermissionProvider,
  PermissionAction,
  PermissionResource,
  User,
} from "../interfaces";
import * as schema from "../schema";

export class DrizzlePermissionAdapter implements IPermissionProvider {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async can(
    user: User,
    action: PermissionAction,
    resource: PermissionResource,
    tenantId?: string,
  ): Promise<boolean> {
    if (user.systemRole === "platform_admin") return true;
    if (!tenantId) return false;

    const context = await this.fetchMemberContext(user.id, tenantId);
    if (!context) return false;

    // Owner override
    if (context.roleName === "Owner") return true;

    // Check permissions
    return context.permissions.some(
      (p) => p.resource === resource && p.action === action,
    );
  }

  async hasRole(
    user: User,
    roleName: string,
    tenantId?: string,
  ): Promise<boolean> {
    if (tenantId) {
      const context = await this.fetchMemberContext(user.id, tenantId);
      return context?.roleId === roleName;
    }
    if (!user.systemRole) return false;
    return user.systemRole === roleName;
  }

  async getPermissions(user: User, tenantId?: string): Promise<string[]> {
    const perms: string[] = [];

    if (user.systemRole === "platform_admin") {
      perms.push("*");
    }

    if (tenantId) {
      const context = await this.fetchMemberContext(user.id, tenantId);

      if (context) {
        perms.push(`role:${context.roleId}`);
        context.permissions.forEach((p) => {
          perms.push(p.id);
        });
      }
    }

    return perms;
  }

  private async fetchMemberContext(userId: string, tenantId: string) {
    const rows = await this.db
      .select({
        roleId: schema.role.id,
        roleName: schema.role.name,
        // Permissions might be null if role has none
        permId: schema.permission.id,
        resource: schema.permission.resource,
        action: schema.permission.action,
      })
      .from(schema.member)
      .innerJoin(schema.role, eq(schema.member.roleId, schema.role.id))
      .leftJoin(
        schema.rolePermission,
        eq(schema.role.id, schema.rolePermission.roleId),
      )
      .leftJoin(
        schema.permission,
        eq(schema.rolePermission.permissionId, schema.permission.id),
      )
      .where(
        and(
          eq(schema.member.userId, userId),
          eq(schema.member.organizationId, tenantId),
        ),
      );

    if (rows.length === 0) return null;

    const first = rows[0];
    const permissions = rows
      .filter((r) => r.permId !== null)
      .map((r) => ({
        id: r.permId!, // Non-null assertion safe due to filter
        resource: r.resource!,
        action: r.action!,
      }));

    return {
      roleId: first.roleId,
      roleName: first.roleName,
      permissions,
    };
  }
}
