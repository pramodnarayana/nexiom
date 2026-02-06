import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";
import { IDENTITY_OPTIONS, IDENTITY_DB } from "../constants";
import type { IdentityModuleOptions } from "../identity.module";
import { v4 as uuidv4 } from "uuid";

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
    const now = new Date();

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
            createdAt: now,
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
        // Handle "system:users:read" -> resource="system:users", action="read" ?
        // OR "users:read" -> resource="users", action="read"
        // Instruction says: "only the first colon separates resource and action"
        // e.g. "system:users:read" => resource="system", action="users:read"?
        // Wait, typical RBAC is resource:action. "system:users" might be resource.
        // User feedback: "split with a limit... so only the first colon separates"
        const separatorIndex = p.indexOf(":");
        if (separatorIndex === -1) {
          throw new Error(`Invalid permission format: ${p}`);
        }
        const resource = p.substring(0, separatorIndex);
        const action = p.substring(separatorIndex + 1);

        return {
          id: p,
          resource,
          action,
          createdAt: now,
        };
      });

      await this.db
        .insert(schema.permission)
        .values(permissionsToInsert)
        .onConflictDoNothing();

      // 3. Assign Permissions to Roles
      const rolePermissionsToInsert: {
        id: string;
        roleId: string;
        permissionId: string;
        organizationId?: string | null;
      }[] = [];

      // Admin: All non-system
      const adminPerms = perms.filter((p) => !p.startsWith("system_"));
      for (const p of adminPerms) {
        rolePermissionsToInsert.push({
          id: uuidv4(),
          roleId: adminRoleId,
          permissionId: p,
        });
      }

      // Member: Read-only permissions
      // We explicitly select 'users:read' and 'tenants:read' or similar safe subsets
      const memberPerms = ["users:read", "tenants:read"];
      for (const p of memberPerms) {
        if (perms.includes(p)) {
          rolePermissionsToInsert.push({
            id: uuidv4(),
            roleId: memberRoleId,
            permissionId: p,
            organizationId: null, // Global
          });
        }
      }

      // Owner: Split assignments
      // 1. Global Tenant Permissions (All non-system) -> orgId: null (Global)
      const tenantPerms = perms.filter(
        (p) => !p.startsWith("system_") && p !== "admin_dashboard:view",
      );
      for (const p of tenantPerms) {
        rolePermissionsToInsert.push({
          id: uuidv4(),
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
          id: uuidv4(),
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
      throw error;
    }
  }
}
