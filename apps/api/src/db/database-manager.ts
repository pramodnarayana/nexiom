import { execSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

/**
 * Enterprise-grade database management utility
 * Provides clean TypeScript interface for database operations
 *
 * Note: Uses execSync to avoid tsx transpilation issues with decorators
 */
export class DatabaseManager {
  private readonly ALLOWED_ENVS = ['development', 'test', 'local'];

  // Cache pg module to avoid repeated dynamic imports
  private static cachedPg: typeof import('pg') | null = null;

  // ... (truncating internal methods for brevity, assuming they are unchanged in this block selection) ...

  // Reset method omitted from replacement range to focus on withDrizzle and imports

  /** Critical permissions to verify in debug output. */
  private static readonly CRITICAL_PERMISSIONS = [
    'system_users:create',
    'users:create',
    'dashboard:view',
  ];

  /**
   * Helper to initialize Drizzle with the correct schema and client,
   * run a callback, and ensure the client is closed.
   */
  private async withDrizzle<T>(
    callback: (
      db: NodePgDatabase<typeof schema>,
      _schema: typeof schema,
    ) => Promise<T>,
  ): Promise<T> {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const dbSchema = await import('./schema');
    const client = await this.getPgClient();

    try {
      const db = drizzle(client, { schema: dbSchema });
      return await callback(db, dbSchema);
    } finally {
      await client.end();
    }
  }

  private async resolvePgModule(): Promise<{
    PgClient: typeof import('pg').Client;
    dbUrl: string;
  }> {
    // Use cached pg module or load it once
    DatabaseManager.cachedPg ??= await import('pg');
    const { Client: PgClient } = DatabaseManager.cachedPg;

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL is not defined');
    }

    return { PgClient, dbUrl };
  }

  /**
   * Helper to execute database operations with optional client reuse
   * If client is provided, reuses it; otherwise creates and closes a new one
   */
  private async withClient<T>(
    client: Client | undefined,
    fn: (c: Client) => Promise<T>,
  ): Promise<T> {
    const { PgClient, dbUrl } = await this.resolvePgModule();

    // Use provided client or create new one
    const dbClient = client || new PgClient({ connectionString: dbUrl });
    const shouldClose = !client; // Only close if we created it

    if (shouldClose) {
      await dbClient.connect();
    }

    try {
      return await fn(dbClient);
    } finally {
      if (shouldClose) {
        await dbClient.end();
      }
    }
  }

  /**
   * Get a connected PostgreSQL client using the cached pg module
   * @private
   */
  private async getPgClient(): Promise<Client> {
    const { PgClient, dbUrl } = await this.resolvePgModule();
    const client = new PgClient({ connectionString: dbUrl });
    await client.connect();
    return client;
  }

  /**
   * Execute SQL query via direct PG connection
   * Optionally accepts a client for connection reuse
   */
  private async execSql(sql: string, client?: Client): Promise<void> {
    await this.withClient(client, async (c) => {
      await c.query(sql);
    });
  }

  /**
   * Execute SQL query and return rows
   * Optionally accepts a client for connection reuse
   */
  private async querySql<T = any>(sql: string, client?: Client): Promise<T[]> {
    return this.withClient(client, async (c) => {
      const res = await c.query(sql);
      return res.rows as T[];
    });
  }

  /**
   * Check if current environment allows destructive operations
   */
  private assertSafeEnvironment(): void {
    const env = process.env.NODE_ENV;
    if (!env || !this.ALLOWED_ENVS.includes(env)) {
      throw new Error(
        `Destructive database operations only allowed in: ${this.ALLOWED_ENVS.join(', ')}. Current: ${env || 'unset'}`,
      );
    }
  }

  /**
   * Drop all database schemas (drizzle + public) and recreate public schema
   *
   * **WARNING**: This operation is destructive and sequential. If any intermediate
   * step fails (particularly after dropping schemas but before recreating public),
   * the database may be left without a public schema.
   *
   * **Recovery**: If dropAll() fails partway through:
   * 1. Re-run dropAll() to complete the operation, OR
   * 2. Manually recreate the public schema:
   *    ```sql
   *    CREATE SCHEMA public;
   *    GRANT ALL ON SCHEMA public TO PUBLIC;
   *    ```
   *
   * **Note**: This method is intended for local development and CLI use only.
   * It reuses a single database connection across all execSql() calls to minimize
   * connection overhead.
   *
   * @throws {Error} If not running in safe environment (development/test/local)
   * @throws {Error} If database operations fail
   */
  async dropAll(): Promise<void> {
    this.assertSafeEnvironment();
    console.log('🗑️  Dropping all schemas...');

    // Reuse single connection for all operations
    const client = await this.getPgClient();

    try {
      // Drop drizzle schema (migration tracking)
      await this.execSql('DROP SCHEMA IF EXISTS drizzle CASCADE;', client);
      console.log('  ✓ Dropped drizzle schema');

      // Drop public schema (all tables)
      await this.execSql('DROP SCHEMA IF EXISTS public CASCADE;', client);
      console.log('  ✓ Dropped public schema');

      // Recreate public schema
      await this.execSql('CREATE SCHEMA public;', client);
      await this.execSql('GRANT ALL ON SCHEMA public TO PUBLIC;', client);
      console.log('  ✓ Recreated public schema');
    } catch (error) {
      throw new Error(
        `Failed to drop schemas: ${error instanceof Error ? error.message : error}`,
        { cause: error },
      );
    } finally {
      await client.end();
    }
  }

  /**
   * Run pending Drizzle migrations
   */
  migrate(): void {
    console.log('🔨 Running migrations...');
    const cwd = path.resolve(__dirname, '../..');
    // Drizzle Kit is a CLI tool, so we still use execSync here (local execution, not docker)
    execSync('pnpm drizzle-kit migrate', {
      stdio: 'inherit',
      cwd,
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    console.log('  ✓ Migrations complete');
  }

  /**
   * Seed database with initial data
   * Creates system organization and seeds RBAC data
   */
  async seed(): Promise<void> {
    this.assertSafeEnvironment();
    console.log('🌱 Seeding database...');

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const schema = await import('./schema');
    const { eq } = await import('drizzle-orm');
    const { seedSystemRbac } =
      await import('@nexiom/identity/utils/rbac-seeding');
    const {
      getRequiredOwnerRoleId,
      getRequiredAdminRoleId,
      getRequiredMemberRoleId,
      getRequiredSystemTenantId,
    } = await import('../constants');

    const client = await this.getPgClient();

    try {
      const db = drizzle(client, { schema });
      const systemTenantId = getRequiredSystemTenantId();

      // 1. Ensure system organization exists
      const existingOrg = await db.query.organization.findFirst({
        where: eq(schema.organization.id, systemTenantId),
      });

      if (!existingOrg) {
        await db.insert(schema.organization).values({
          id: systemTenantId,
          name: 'Nexiom Platform',
          slug: 'system',
          isSystem: true,
        });
        console.log('  ✓ System organization created');
      }

      // 2. Seed RBAC data
      const config = {
        ownerRoleId: getRequiredOwnerRoleId(),
        adminRoleId: getRequiredAdminRoleId(),
        memberRoleId: getRequiredMemberRoleId(),
        systemTenantId,
      };

      await seedSystemRbac(db, config, console);
      console.log('  ✓ Seeding complete');
    } finally {
      await client.end();
    }
  }

  /**
   * Truncate all tables (preserves schema)
   */
  async truncateAll(): Promise<void> {
    this.assertSafeEnvironment();
    console.log('🧹 Truncating all tables...');

    const client = await this.getPgClient();

    try {
      const tables = await this.querySql<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`,
        client,
      );

      if (tables.length === 0) {
        console.log('  ℹ️  No tables found in public schema to truncate');
        return;
      }

      const quotedTables = tables
        .map((t) => `"${t.table_name.replace(/"/g, '""')}"`)
        .join(', ');
      const sql = `TRUNCATE TABLE ${quotedTables} CASCADE;`;
      await this.execSql(sql, client);
      console.log(`  ✓ Truncated ${tables.length} tables`);
    } catch (error) {
      console.log(`  ⚠️  Truncate failed: ${String(error)}`);
      throw error;
    } finally {
      await client.end();
    }
  }

  /**
   * Fresh install: Drop everything + Migrate + Seed
   * Complete database rebuild
   */
  async fresh(): Promise<void> {
    this.assertSafeEnvironment();
    console.log('🆕 Fresh database install...\n');

    await this.dropAll();
    console.log();

    this.migrate();
    console.log();

    await this.seed();
    console.log();

    console.log('✅ Fresh install complete!');
  }

  /**
   * Reset: Truncate + Seed
   * Clears data but preserves schema
   */
  async reset(): Promise<void> {
    this.assertSafeEnvironment();
    console.log('🔄 Resetting database...\n');

    await this.truncateAll();
    console.log();

    await this.seed();
    console.log();

    console.log('✅ Reset complete!');
  }

  /**
   * Debug RBAC permissions for a role
   */
  async debugPermissions(roleName: string): Promise<void> {
    console.log(`🔍 Debugging permissions for role: ${roleName}...`);

    await this.withDrizzle(async (db, schema) => {
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
      const permIds = perms.map((p) => p.permissionId).sort();

      for (const p of permIds) console.log(`    - ${p}`);

      const critical = DatabaseManager.CRITICAL_PERMISSIONS;
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

    await this.withDrizzle(async (db, schema) => {
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
        await import('@nexiom/identity/utils/role-normalization');

      // Resolve Member Role Permissions (this is what the app actually uses)
      if (user.members && user.members.length > 0) {
        // Enforce Single-Tenant Rule: Use only the first member record
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

      const critical = DatabaseManager.CRITICAL_PERMISSIONS;
      console.log('\n  Critical Capability Check:');
      for (const c of critical) {
        const has = allPermissions.has(c);
        console.log(`    ${has ? '✅' : '❌'} ${c}`);
      }
    });
  }
}
