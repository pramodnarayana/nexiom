import { Inject, Injectable } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { IDENTITY_DB } from "../constants";
import { eq, and } from "drizzle-orm";
import type {
  IPermissionProvider,
  PermissionAction,
  PermissionResource,
  User,
} from "../interfaces";
import * as schema from "../schema";

@Injectable()
export class DrizzlePermissionAdapter implements IPermissionProvider {
  constructor(
    @Inject(IDENTITY_DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async can(
    user: User,
    action: PermissionAction,
    resource: PermissionResource,
    tenantId?: string,
  ): Promise<boolean> {
    if (!tenantId) return false;

    const context = await this.fetchMemberContext(user.id, tenantId);
    if (!context) return false;

    // Check permissions
    // 1. Global Wildcard
    if (context.permissions.some((p) => p.resource === "*" && p.action === "*"))
      return true;

    // 2. Resource Wildcard
    if (
      context.permissions.some(
        (p) => p.resource === resource && p.action === "*",
      )
    )
      return true;

    // 3. Exact Match
    return context.permissions.some(
      (p) => p.resource === resource && p.action === action,
    );
  }

  async hasRole(
    user: User,
    roleId: string,
    tenantId?: string,
  ): Promise<boolean> {
    if (tenantId) {
      const context = await this.fetchMemberContext(user.id, tenantId);
      return context?.roleId === roleId;
    }
    return false;
  }

  async getPermissions(user: User, tenantId?: string): Promise<string[]> {
    const perms: string[] = [];

    if (tenantId) {
      const context = await this.fetchMemberContext(user.id, tenantId);

      if (context) {
        // 3. Explicit Permissions (Scoped by fetchMemberContext logic)
        context.permissions.forEach((p) => {
          if (p.resource === "*" && p.action === "*") {
            perms.push("*");
          } else {
            perms.push(`${p.resource}:${p.action}`);
          }
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
        permOrgId: schema.rolePermission.organizationId,
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
    const permissionsMap = new Map<
      string,
      { id: string; resource: string; action: string }
    >();

    rows.forEach((r) => {
      // Permission filtering logic:
      // Include if permission is Global (permOrgId is null)
      // OR if permission is Scoped to current Tenant (permOrgId === tenantId)
      const isScopedCorrectly = !r.permOrgId || r.permOrgId === tenantId;

      if (r.permId && isScopedCorrectly && !permissionsMap.has(r.permId)) {
        permissionsMap.set(r.permId, {
          id: r.permId,
          resource: r.resource!,
          action: r.action!,
        });
      }
    });

    const permissions = Array.from(permissionsMap.values());

    return {
      roleId: first.roleId,
      roleName: first.roleName,
      permissions,
    };
  }
}
