import { Injectable } from '@nestjs/common';
import { PgConnectionPool } from '../infrastructure/pg-connection.pool.js';
import { EnvironmentGuardService } from './environment-guard.service.js';

@Injectable()
export class RbacInspectorService {
  static readonly CRITICAL_PERMISSIONS = [
    'workspaces:create',
    'connections:create',
    'connections:delete',
    'triggers:create',
    'users:delete',
  ];

  constructor(
    private readonly connectionPool: PgConnectionPool,
    private readonly environmentGuard: EnvironmentGuardService,
  ) {}

  async debugPermissions(roleName: string): Promise<void> {
    console.log(`🔍 Debugging permissions for role: ${roleName}...`);

    await this.connectionPool.withDrizzle(async (db, schema) => {
      const { eq } = await import('drizzle-orm');

      const role = await db.query.role.findFirst({
        where: eq(schema.role.name, roleName),
      });

      if (!role) {
        console.error(`❌ Role '${roleName}' not found`);
        return;
      }

      console.log(`  Found Role: ${role.name} (${role.id})`);

      const perms = await db.query.rolePermission.findMany({
        where: eq(schema.rolePermission.roleId, role.id),
      });

      console.log(`  Permissions (${perms.length}):`);
      const permIds = perms
        .map((p) => p.permissionId)
        .sort((a: string, b: string) => a.localeCompare(b));

      for (const p of permIds) console.log(`    - ${p}`);

      const critical = RbacInspectorService.CRITICAL_PERMISSIONS;
      console.log('\n  Critical Check:');
      for (const c of critical) {
        const has = permIds.includes(c);
        console.log(`    ${has ? '✅' : '❌'} ${c}`);
      }
    });
  }

  /**
   * Check permissions for a specific user (by ID or Email)
   */
  async checkUserPermissions(identifier: string): Promise<void> {
    console.log(`🔍 Checking permissions for user: ${identifier}...`);

    await this.connectionPool.withDrizzle(async (db, schema) => {
      const { eq, or } = await import('drizzle-orm');

      // Find user by ID or Email
      const user = await db.query.user.findFirst({
        where: or(
          eq(schema.user.id, identifier),
          eq(schema.user.email, identifier),
        ),
        with: {
          members: {
            with: {
              role: {
                with: {
                  permissions: true,
                },
              },
            },
          },
        },
      });

      if (!user) {
        console.error(`❌ User '${identifier}' not found`);
        return;
      }

      console.log(`  Found User: ${user.email} (${user.id})`);

      const allPermissions = new Set<string>();

      const { normalizeRole } =
        await import('@soopa/identity/utils/role-normalization');

      // Resolve Member Role Permissions (this is what the app actually uses)
      if (user.members && user.members.length > 0) {
        // Enforce Single-Tenant Rule: Use only the first member record
        if (user.members.length > 1) {
          console.warn(
            `  ⚠️  User has ${user.members.length} memberships. Single-Tenant Rule enforces first only.`,
          );
        }
        const member = user.members[0];
        const normalized = normalizeRole(member.role);
        const roleName = normalized.name;
        const roleId = normalized.id;

        console.log(
          `    - Org: ${member.organizationId}, Role: ${roleName} (${roleId})`,
        );

        for (const p of normalized.permissions) {
          allPermissions.add(p.permissionId);
        }

        // Supplementary lookup for legacy string roles if no relation or permissions found
        // This handles cases like 'owner' role which might not be fully seeded with permission relations yet
      } else {
        console.log('  Memberships: None');
      }

      console.log(`\n  Effective Permissions (${allPermissions.size}):`);
      const sortedPerms = Array.from(allPermissions).sort((a, b) =>
        a.localeCompare(b),
      );
      for (const p of sortedPerms) console.log(`    - ${p}`);

      const critical = RbacInspectorService.CRITICAL_PERMISSIONS;
      console.log('\n  Critical Capability Check:');
      for (const c of critical) {
        const has = allPermissions.has(c);
        console.log(`    ${has ? '✅' : '❌'} ${c}`);
      }
    });
  }
}
