import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";
import {
  IDENTITY_OPTIONS,
  IDENTITY_DB,
  ALL_PERMISSIONS,
  PermissionType,
} from "../constants";
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
    // Only seed if RBAC data is missing (performance optimization)
    // Check for existence of any role assignments to ensure complete seeding
    const existingAssignments = await this.db.query.rolePermission.findMany({
      limit: 1,
    });
    if (existingAssignments.length === 0) {
      await this.seed();
    } else {
      this.logger.log("RBAC data already exists, skipping seed");
    }
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
      const perms = ALL_PERMISSIONS;

      const permissionsToInsert = perms.map((p) => {
        // Map to permission objects (split permission string at the first ':'
        // so the portion before the first colon is resource and the remainder is action)
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

      // Shared filter predicate for system/scoped permissions
      const isSystemPerm = (p: string) =>
        p.startsWith("system_") || p === "admin_dashboard:view";

      // Admin: Split assignments
      // 1. Global Tenant Permissions (All non-system) -> orgId: null (Global)
      //    Explicitly exclude admin_dashboard:view so it can be scoped to System Tenant
      const adminGlobalPerms = perms.filter((p) => !isSystemPerm(p));
      for (const p of adminGlobalPerms) {
        rolePermissionsToInsert.push({
          id: uuidv4(),
          roleId: adminRoleId,
          permissionId: p,
          organizationId: null, // Explicit null
        });
      }

      // 2. System Permissions -> orgId: SYSTEM_TENANT_ID (Scoped)
      const adminSystemPerms = perms.filter(isSystemPerm);
      for (const p of adminSystemPerms) {
        rolePermissionsToInsert.push({
          id: uuidv4(),
          roleId: adminRoleId,
          permissionId: p,
          organizationId: systemTenantId, // Scoped
        });
      }

      // Member: Read-only permissions
      // INTENTIONAL: Only 'users:read' and 'tenants:read' are allowed for security.
      // This is a curated, safe subset - not derived dynamically from ALL_PERMISSIONS.
      const memberPerms = ["users:read", "tenants:read"];
      for (const p of memberPerms) {
        if (perms.includes(p as PermissionType)) {
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
      const tenantPerms = perms.filter((p) => !isSystemPerm(p));
      for (const p of tenantPerms) {
        rolePermissionsToInsert.push({
          id: uuidv4(),
          roleId: ownerRoleId,
          permissionId: p,
          organizationId: null, // Global
        });
      }

      // 2. System Permissions -> orgId: SYSTEM_TENANT_ID (Scoped)
      // This means a User is ONLY an "Owner" of the system if they are in the System Tenant Context.
      const systemPerms = perms.filter(isSystemPerm);
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
