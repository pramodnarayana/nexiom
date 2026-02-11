import { execSync } from 'node:child_process';
import type { Client } from 'pg';

/**
 * Enterprise-grade database management utility
 * Provides clean TypeScript interface for database operations
 *
 * Note: Uses execSync to avoid tsx transpilation issues with decorators
 */
export class DatabaseManager {
  private readonly ALLOWED_ENVS = ['development', 'test', 'local'];

  /**
   * Helper to execute database operations with optional client reuse
   * If client is provided, reuses it; otherwise creates and closes a new one
   */
  private async withClient<T>(
    client: Client | undefined,
    fn: (c: Client) => Promise<T>,
  ): Promise<T> {
    const { Client: PgClient } = await import('pg');
    const dbUrl = process.env.DATABASE_URL;

    if (!dbUrl) {
      throw new Error('DATABASE_URL is not defined');
    }

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
    const { Client } = await import('pg');
    const dbUrl = process.env.DATABASE_URL;

    if (!dbUrl) {
      throw new Error('DATABASE_URL is not defined');
    }

    const client = new Client({ connectionString: dbUrl });
    await client.connect();

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
    // Drizzle Kit is a CLI tool, so we still use execSync here (local execution, not docker)
    execSync('pnpm drizzle-kit migrate', {
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    console.log('  ✓ Migrations complete');
  }

  /**
   * Seed database with initial data
   * Creates system organization and seeds RBAC data
   */
  async seed(): Promise<void> {
    console.log('🌱 Seeding database...');

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { Client } = await import('pg');
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

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL not found');
    }

    const client = new Client({ connectionString: dbUrl });
    await client.connect();

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

    // Dynamically discover all tables from Postgres catalog
    // This is more robust than iterating schema exports which can have symbol/version mismatches
    const tables = await this.querySql<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`,
    );

    if (tables.length === 0) {
      console.log('  ℹ️  No tables found in public schema to truncate');
      return;
    }

    try {
      const quotedTables = tables.map((t) => `"${t.table_name}"`).join(', ');
      const sql = `TRUNCATE TABLE ${quotedTables} CASCADE;`;
      await this.execSql(sql);
      console.log(`  ✓ Truncated ${tables.length} tables`);
    } catch (error) {
      console.log(`  ⚠️  Truncate failed: ${String(error)}`);
      throw error;
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
}
