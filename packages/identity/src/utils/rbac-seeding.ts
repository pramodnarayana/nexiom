import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import * as schema from "../schema.js";
import {
  ALL_PERMISSIONS,
  isSystemPermission,
  PermissionType,
} from "../constants.js";
import { inArray } from "drizzle-orm";

export const MEMBER_BASE_PERMS: PermissionType[] = [
  "users:read",
  "tenants:read",
  "dashboard:read",
  "workspaces:read",
  "stitches:read",
];

export const MEMBER_SYSTEM_PERMS: PermissionType[] = [
  "admin_dashboard:view",
  "system_users:read",
  "system_tenants:read",
];

export interface RbacConfig {
  ownerRoleId: string;
  adminRoleId: string;
  memberRoleId: string;
  systemTenantId: string;
}

export interface IRbacRepository {
  ensureRoles(
    roles: {
      id: string;
      name: string;
      isSystem: boolean;
      description: string;
      createdAt: Date;
    }[],
  ): Promise<void>;
  ensurePermissions(
    permissions: {
      id: string;
      resource: string;
      action: string;
      createdAt: Date;
    }[],
  ): Promise<void>;
  getExistingRolePermissions(
    roleIds: string[],
  ): Promise<
    { roleId: string; permissionId: string; organizationId: string | null }[]
  >;
  insertRolePermissions(
    rolePermissions: {
      id: string;
      roleId: string;
      permissionId: string;
      organizationId: string | null;
    }[],
  ): Promise<void>;
  transaction<T>(cb: (repo: IRbacRepository) => Promise<T>): Promise<T>;
}

export class DrizzleRbacRepository implements IRbacRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async ensureRoles(
    roles: {
      id: string;
      name: string;
      isSystem: boolean;
      description: string;
      createdAt: Date;
    }[],
  ): Promise<void> {
    await this.db.insert(schema.role).values(roles).onConflictDoNothing();
  }

  async ensurePermissions(
    permissions: {
      id: string;
      resource: string;
      action: string;
      createdAt: Date;
    }[],
  ): Promise<void> {
    await this.db
      .insert(schema.permission)
      .values(permissions)
      .onConflictDoNothing();
  }

  async getExistingRolePermissions(
    roleIds: string[],
  ): Promise<
    { roleId: string; permissionId: string; organizationId: string | null }[]
  > {
    if (roleIds.length === 0) return [];

    return await this.db
      .select({
        roleId: schema.rolePermission.roleId,
        permissionId: schema.rolePermission.permissionId,
        organizationId: schema.rolePermission.organizationId,
      })
      .from(schema.rolePermission)
      .where(inArray(schema.rolePermission.roleId, roleIds));
  }

  async insertRolePermissions(
    rolePermissions: {
      id: string;
      roleId: string;
      permissionId: string;
      organizationId: string | null;
    }[],
  ): Promise<void> {
    if (rolePermissions.length > 0) {
      await this.db.insert(schema.rolePermission).values(rolePermissions);
    }
  }

  async transaction<T>(cb: (repo: IRbacRepository) => Promise<T>): Promise<T> {
    // Check if db is already a transaction (has no transaction method)
    if (
      typeof (this.db as unknown as Record<string, unknown>).transaction !==
      "function"
    ) {
      return cb(this);
    }

    return await this.db.transaction(async (tx) => {
      const txRepo = new DrizzleRbacRepository(
        tx as unknown as NodePgDatabase<typeof schema>,
      );
      return await cb(txRepo);
    });
  }
}

export async function seedSystemRbac(
  repo: IRbacRepository,
  config: RbacConfig,
  logger: Logger | Console = console,
) {
  logger.log("Checking RBAC consistency (Canonical)...");
  const { ownerRoleId, adminRoleId, memberRoleId, systemTenantId } = config;
  const now = new Date();

  if (new Set([ownerRoleId, adminRoleId, memberRoleId]).size !== 3) {
    throw new Error(
      `Duplicate Role IDs detected: Owner=${ownerRoleId}, Admin=${adminRoleId}, Member=${memberRoleId}. Roles must be distinct.`,
    );
  }

  try {
    await repo.transaction(async (txRepo) => {
      const roles = [
        {
          id: ownerRoleId,
          name: "owner",
          isSystem: true,
          description: "Full access",
          createdAt: now,
        },
        {
          id: adminRoleId,
          name: "admin",
          isSystem: true,
          description: "Manage users and settings",
          createdAt: now,
        },
        {
          id: memberRoleId,
          name: "member",
          isSystem: true,
          description: "Read only access",
          createdAt: now,
        },
      ];

      await txRepo.ensureRoles(roles);

      const perms = ALL_PERMISSIONS;
      const permissionsToInsert = perms.map((p) => {
        const separatorIndex = p.indexOf(":");
        if (separatorIndex === -1)
          throw new Error(`Invalid permission format: ${p}`);
        return {
          id: p,
          resource: p.substring(0, separatorIndex),
          action: p.substring(separatorIndex + 1),
          createdAt: now,
        };
      });

      await txRepo.ensurePermissions(permissionsToInsert);

      const rolePermissionsToInsert: {
        id: string;
        roleId: string;
        permissionId: string;
        organizationId: string | null;
      }[] = [];

      const addPermissionsForRole = (
        roleId: string,
        permissions: readonly string[],
        scopedOrganizationId: string,
      ) => {
        for (const p of permissions) {
          const isSystem = isSystemPermission(p);
          const orgId = isSystem ? scopedOrganizationId : null;
          rolePermissionsToInsert.push({
            id: uuidv4(),
            roleId,
            permissionId: p,
            organizationId: orgId,
          });
        }
      };

      addPermissionsForRole(adminRoleId, perms, systemTenantId);

      const memberBasePerms = MEMBER_BASE_PERMS;
      const memberSystemPerms = MEMBER_SYSTEM_PERMS;

      const allMemberPerms = [...memberBasePerms, ...memberSystemPerms];
      const invalidPerms = allMemberPerms.filter((p) => !perms.includes(p));
      if (invalidPerms.length > 0) {
        throw new Error(
          `Invalid member permissions configured: ${invalidPerms.join(", ")}. Must be in ALL_PERMISSIONS.`,
        );
      }

      for (const p of memberBasePerms) {
        rolePermissionsToInsert.push({
          id: uuidv4(),
          roleId: memberRoleId,
          permissionId: p,
          organizationId: null,
        });
      }

      for (const p of memberSystemPerms) {
        rolePermissionsToInsert.push({
          id: uuidv4(),
          roleId: memberRoleId,
          permissionId: p,
          organizationId: systemTenantId,
        });
      }

      addPermissionsForRole(ownerRoleId, perms, systemTenantId);

      if (rolePermissionsToInsert.length > 0) {
        const existing = await txRepo.getExistingRolePermissions([
          ownerRoleId,
          adminRoleId,
          memberRoleId,
        ]);

        const existingSet = new Set(
          existing.map(
            (e) =>
              `${e.roleId}|${e.permissionId}|${e.organizationId ?? "__NULL__"}`,
          ),
        );

        const toInsert = rolePermissionsToInsert.filter((rp) => {
          const key = `${rp.roleId}|${rp.permissionId}|${rp.organizationId ?? "__NULL__"}`;
          if (existingSet.has(key)) return false;
          existingSet.add(key);
          return true;
        });

        if (toInsert.length > 0) {
          await txRepo.insertRolePermissions(toInsert);
          logger.log(`Inserted ${toInsert.length} new role permissions.`);
        } else {
          logger.log("No new role permissions to insert.");
        }
      }
    });

    logger.log("RBAC Seeding Complete (Canonical)");
  } catch (error) {
    logger.error("Failed to seed RBAC", error);
    throw error;
  }
}
