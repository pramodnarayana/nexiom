import { execSync } from 'node:child_process';

/**
 * Enterprise-grade database management utility
 * Provides clean TypeScript interface for database operations
 *
 * Note: Uses execSync to avoid tsx transpilation issues with decorators
 */
export class DatabaseManager {
  private readonly ALLOWED_ENVS = ['development', 'test', 'local'];

  /**
   * Execute psql command via Docker
   */
  private execPsql(sqlCommand: string): void {
    const containerName = 'nexiom-postgres-1';
    const command = String.raw`docker exec ${containerName} psql -U user -d nexiom_local -c "${sqlCommand.replaceAll('"', '\\"')}"`;

    execSync(command, {
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
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
   * Drop all database schemas (drizzle + public)
   * Completely wipes the database
   */
  dropAll(): void {
    this.assertSafeEnvironment();
    console.log('🗑️  Dropping all schemas...');

    try {
      // Drop drizzle schema (migration tracking)
      this.execPsql('DROP SCHEMA IF EXISTS drizzle CASCADE;');
      console.log('  ✓ Dropped drizzle schema');

      // Drop public schema (all tables)
      this.execPsql('DROP SCHEMA IF EXISTS public CASCADE;');
      console.log('  ✓ Dropped public schema');

      // Recreate public schema
      this.execPsql('CREATE SCHEMA public;');
      this.execPsql('GRANT ALL ON SCHEMA public TO PUBLIC;');
      console.log('  ✓ Recreated public schema');
    } catch (error) {
      throw new Error(
        `Failed to drop schemas: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Run pending Drizzle migrations
   */
  migrate(): void {
    console.log('🔨 Running migrations...');

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
      await import('@nexiom/identity/src/utils/rbac-seeding');
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
  truncateAll(): void {
    this.assertSafeEnvironment();
    console.log('🧹 Truncating all tables...');

    // List of all known tables
    const allTables = [
      'invitation',
      'member',
      'session',
      'account',
      'verification',
      'organization',
      'user',
      'role',
      'permission',
      'role_permission',
    ];

    // Try truncating all tables first
    try {
      const quotedTables = allTables.map((t) => `"${t}"`).join(', ');
      const sql = `TRUNCATE TABLE ${quotedTables} CASCADE;`;
      this.execPsql(sql);
      console.log(`  ✓ Truncated ${allTables.length} tables`);
      return; // Success, exit early
    } catch {
      // Some tables don't exist, continue to fallback
    }

    // Fallback: truncate only core tables (RBAC tables may not exist yet)
    const coreTables = [
      'account',
      'member',
      'session',
      'organization',
      'user',
      'verification',
    ];

    try {
      const quotedCore = coreTables.map((t) => `"${t}"`).join(', ');
      const sql = `TRUNCATE TABLE ${quotedCore} CASCADE;`;
      this.execPsql(sql);
      console.log(`  ✓ Truncated ${coreTables.length} core tables`);
    } catch {
      // Even core tables don't exist - database is likely empty
      console.log('  ℹ️  No tables to truncate (database may be empty)');
    }
  }

  /**
   * Fresh install: Drop everything + Migrate + Seed
   * Complete database rebuild
   */
  async fresh(): Promise<void> {
    this.assertSafeEnvironment();
    console.log('🆕 Fresh database install...\n');

    this.dropAll();
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

    this.truncateAll();
    console.log();

    await this.seed();
    console.log();

    console.log('✅ Reset complete!');
  }
}
