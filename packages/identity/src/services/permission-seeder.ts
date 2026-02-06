import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";
import { IDENTITY_OPTIONS, IDENTITY_DB } from "../constants";
import type { IdentityModuleOptions } from "../identity.module";

@Injectable()
export class PermissionSeeder implements OnModuleInit {
  private readonly logger = new Logger(PermissionSeeder.name);

  constructor(
    @Inject(IDENTITY_DB) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityModuleOptions,
  ) {}

  async onModuleInit() {
    await this.seed();
  }

  async seed() {
    this.logger.log("Checking RBAC consistency...");

    const { ownerRoleId, adminRoleId, memberRoleId, systemTenantId } =
      this.options.constants;

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

      await this.db
        .insert(schema.role)
        .values(
          roles.map((r) => ({
            ...r,
            createdAt: new Date(),
          })),
        )
        .onConflictDoNothing();

      // 2. Ensure Permissions
      const perms = [
        "users:read",
        "users:create",
        "users:update",
        "users:delete",
        "users:manage",
        "tenants:read",
        "tenants:create",
        "tenants:update",
        "tenants:delete",
        "tenants:manage",
        "dashboard:read",
        "admin_dashboard:view",
        "settings:manage",
        "settings:read",
        "system_users:read",
        "system_users:manage",
        "system_users:invite",
        "system_tenants:read",
        "system_tenants:manage",
      ];

      const permissionsToInsert = perms.map((p) => {
        const [resource, action] = p.split(":");
        return {
          id: p,
          resource,
          action,
          createdAt: new Date(),
        };
      });

      await this.db
        .insert(schema.permission)
        .values(permissionsToInsert)
        .onConflictDoNothing();

      // 3. Assign Permissions to Roles
      const rolePermissionsToInsert: {
        roleId: string;
        permissionId: string;
        organizationId?: string | null;
      }[] = [];

      // Admin: All non-system
      const adminPerms = perms.filter((p) => !p.startsWith("system_"));
      for (const p of adminPerms) {
        rolePermissionsToInsert.push({
          roleId: adminRoleId,
          permissionId: p,
        });
      }

      // Owner: Split assignments
      // 1. Global Tenant Permissions (All non-system) -> orgId: null (Global)
      const tenantPerms = perms.filter(
        (p) => !p.startsWith("system_") && p !== "admin_dashboard:view",
      );
      for (const p of tenantPerms) {
        rolePermissionsToInsert.push({
          roleId: ownerRoleId,
          permissionId: p,
          organizationId: null, // Global
        });
      }

      // 2. System Permissions -> orgId: SYSTEM_TENANT_ID (Scoped)
      // This means a User is ONLY an "Admin" of the system if they are in the System Tenant Context.
      const systemPerms = perms.filter(
        (p) => p.startsWith("system_") || p === "admin_dashboard:view",
      );
      for (const p of systemPerms) {
        rolePermissionsToInsert.push({
          roleId: ownerRoleId, // Scoped Owner acts as System Admin
          permissionId: p,
          organizationId: systemTenantId, // Scoped
        });
      }

      await this.db
        .insert(schema.rolePermission)
        .values(rolePermissionsToInsert)
        .onConflictDoNothing();

      this.logger.log("RBAC Seeding Complete (Scoped)");
    } catch (error) {
      this.logger.error("Failed to seed RBAC", error);
    }
  }
}
