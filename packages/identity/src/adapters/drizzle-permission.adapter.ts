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
    // 1. System Level Override (Platform Admin)
    if (user.systemRole === "platform_admin") {
      return true;
    }

    // 2. Tenant Level Checks
    if (tenantId) {
      // We need to fetch the member role
      const member = await this.findMember(user.id, tenantId);

      if (!member) return false;

      // Simple RBAC Logic for now (Expandable to Capability mapping later)
      if (member.role === "admin" || member.role === "owner") {
        return true;
      }

      if (member.role === "user") {
        // Users can read everything, edit nothing (Simplified policy)
        if (action === "read") return true;
      }

      // Define granular rules here
      return false;
    }

    // 3. User Level (Self)
    if (resource === "user" && action === "update") {
      // Deny until instance-level checks (e.g., targetUserId) are supported.
      return false;
    }

    return false;
  }

  async hasRole(user: User, role: string, tenantId?: string): Promise<boolean> {
    if (tenantId) {
      const member = await this.findMember(user.id, tenantId);
      return member?.role === role;
    }
    if (!user.systemRole) return false;
    return user.systemRole === role;
  }

  async getPermissions(user: User, tenantId?: string): Promise<string[]> {
    const perms: string[] = [];

    if (user.systemRole === "platform_admin") {
      perms.push("*");
    }

    if (tenantId) {
      const member = await this.findMember(user.id, tenantId);
      if (member) {
        perms.push(`role:${member.role}`);
        if (member.role === "admin") perms.push("manage:tenant");
      }
    }

    return perms;
  }

  private async findMember(userId: string, tenantId: string) {
    return this.db.query.member.findFirst({
      where: and(
        eq(schema.member.userId, userId),
        eq(schema.member.organizationId, tenantId),
      ),
    });
  }
}
