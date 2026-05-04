import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, randomBytes } from 'node:crypto';
import { Client, type Pool } from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import * as schema from './schema.js';

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
    const dbSchema = await import('./schema.js');
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

    // Drop tenant databases so fresh truly starts from scratch
    await this.dropTenantDatabaseIfExists('nexiom_tenant_system');
  }

  /**
   * Drop a tenant database if it exists (local dev only).
   */
  private async dropTenantDatabaseIfExists(dbName: string): Promise<void> {
    const { PgClient } = await this.resolvePgModule();
    const adminClient = new PgClient({
      connectionString: process.env.DATABASE_URL,
    });
    await adminClient.connect();
    try {
      // Terminate any existing connections first
      await adminClient.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      console.log(`  ✓ Dropped tenant database: ${dbName}`);
    } finally {
      await adminClient.end();
    }
  }

  /**
   * Run pending global Drizzle migrations (nexiom_global DB only).
   * Applies identity, registry, and pieces schema.
   */
  migrate(): void {
    this.migrateGlobal();
  }

  migrateGlobal(): void {
    console.log('🔨 Running global DB migrations...');
    let rootCwd: string;
    if (typeof __dirname !== 'undefined') {
      rootCwd = path.resolve(__dirname, '../../../../');
    } else {
      rootCwd = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../../',
      );
    }
    execSync('pnpm db:migrate', {
      stdio: 'inherit',
      cwd: rootCwd,
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    console.log('  ✓ Global migrations complete');
  }

  /**
   * Create a new tenant database on the same Postgres server and run
   * all tenant-schema migrations against it.
   *
   * @param dbName  Database name to create e.g. "nexiom_tenant_abc123"
   * @param hostUrl Full connection URL to the server (with credentials, without db path)
   *                e.g. "postgres://user:password@localhost:5432"
   */
  async createTenantDatabase(dbName: string, hostUrl: string): Promise<void> {
    const { PgClient } = await this.resolvePgModule();

    // CREATE DATABASE must run outside a transaction — connect to the global DB
    const adminClient = new PgClient({
      connectionString: process.env.DATABASE_URL,
    });
    await adminClient.connect();

    try {
      // Idempotent — skip if the DB already exists
      const existing = await adminClient.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [dbName],
      );
      if (existing.rowCount === 0) {
        // Sanitize dbName (alphanumeric + underscores only)
        if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
          throw new Error(`Invalid tenant database name: ${dbName}`);
        }
        await adminClient.query(`CREATE DATABASE "${dbName}"`);
        console.log(`  ✓ Created tenant database: ${dbName}`);
      } else {
        console.log(`  ℹ️  Tenant database already exists: ${dbName}`);
      }
    } finally {
      await adminClient.end();
    }

    // Now run tenant migrations against the new (or existing) database
    await this.migrateTenant(dbName, hostUrl);
  }

  /**
   * Run tenant-schema Drizzle migrations against a specific tenant database.
   * Uses the drizzle/tenant migration folder generated from drizzle.config.tenant.ts.
   */
  async migrateTenant(dbName: string, hostUrl: string): Promise<void> {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { Pool } = await import('pg');

    const tenantUrl = `${hostUrl.replace(/\/$/, '')}/${dbName}`;

    let rootDir: string;
    if (typeof __dirname !== 'undefined') {
      rootDir = path.resolve(__dirname, '../../../../');
    } else {
      rootDir = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../../',
      );
    }
    const migrationsFolder = path.join(
      rootDir,
      'packages/database/drizzle/tenant',
    );

    const pool = new Pool({ connectionString: tenantUrl, max: 2 });
    try {
      const db = drizzle(pool);
      await migrate(db, { migrationsFolder });
      console.log(`  ✓ Tenant migrations applied to: ${dbName}`);
    } finally {
      await pool.end();
    }
  }

  /**
   * Seed database with initial data
   * Creates system organization and seeds RBAC data
   */
  async seed(): Promise<void> {
    this.assertSafeEnvironment();
    console.log('🌱 Seeding database...');

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const schema = await import('./schema.js');
    const { eq, sql, notInArray } = await import('drizzle-orm');
    const { seedSystemRbac } =
      await import('@nexiom/identity/utils/rbac-seeding');
    const {
      getRequiredOwnerRoleId,
      getRequiredAdminRoleId,
      getRequiredMemberRoleId,
      getRequiredSystemTenantId,
    } = await import('../constants.js');

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

      // Create a separate DB instance with identity schema for seedSystemRbac
      const identitySchema = await import('@nexiom/identity/schema');
      const identityDb = drizzle(client, { schema: identitySchema });
      await seedSystemRbac(identityDb, config, console);

      // 3. Seed Marketplace Pieces dynamically from monorepo (Enterprise-Grade)
      const { v4: uuidv4Marketplace } = await import('uuid');
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      console.log('  🧩 Auto-discovering marketplace pieces...');

      // Resolve the pieces directory from the current file's location so the
      // path is correct regardless of working directory (CI, Docker, local).
      // __dirname equivalent for ESM: fileURLToPath(import.meta.url) gives us
      // <monorepo>/apps/api/src/db/database-manager.{ts|js}
      // → resolve 4 levels up to reach the monorepo root.
      const thisFile = fileURLToPath(import.meta.url);
      const monorepoRoot = path.resolve(path.dirname(thisFile), '../../../../');
      const piecesDir = path.join(monorepoRoot, 'engine/application/pieces');
      let pieceFolders: string[];
      let discoverySuccess = true;
      try {
        pieceFolders = await fs.readdir(piecesDir);
      } catch (readdirErr) {
        console.warn(
          `  ⚠️  Could not read pieces directory "${piecesDir}": ${readdirErr instanceof Error ? readdirErr.message : String(readdirErr)}. ` +
            `No marketplace pieces will be seeded.`,
        );
        pieceFolders = [];
        discoverySuccess = false;
      }
      const discoveredPieces = [];

      for (const folder of pieceFolders) {
        const piecePath = path.join(piecesDir, folder);
        const stat = await fs.stat(piecePath).catch((err: unknown) => {
          console.warn(
            `    ⚠️ Could not stat piece folder "${folder}": ${err instanceof Error ? err.message : String(err)}. Marking discovery as failed.`,
          );
          discoverySuccess = false;
          return null;
        });

        if (stat?.isDirectory()) {
          try {
            // Read package.json to get the canonical npm package name
            const pkgPath = path.join(piecePath, 'package.json');
            const pkgRaw = await fs.readFile(pkgPath, 'utf-8');
            const pkg = JSON.parse(pkgRaw) as { name: string; version: string };

            // Dynamically import the installed module just like Nexiom Engine does
            const mod = (await import(pkg.name)) as Record<string, unknown>;
            let pieceDef: Record<string, unknown> | null = null;

            for (const exported of Object.values(mod)) {
              if (
                exported &&
                typeof exported === 'object' &&
                'name' in exported &&
                'displayName' in exported &&
                'logoUrl' in exported
              ) {
                pieceDef = exported as Record<string, unknown>;
                break;
              }
            }

            if (pieceDef) {
              discoveredPieces.push({
                id: uuidv4Marketplace(),
                name: String(pieceDef.name),
                displayName: String(pieceDef.displayName),
                packageName: pkg.name,
                version: pkg.version || 'workspace',
                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                logoUrl: String(pieceDef.logoUrl || ''),
                enabled: true,
              });
              console.log(
                `    ✅ Discovered piece: ${String(pieceDef.displayName)} (${pkg.name})`,
              );
            }
          } catch (e) {
            console.warn(
              `    ⚠️ Failed to load piece from folder ${folder}: ${e instanceof Error ? e.message : String(e)}. Marking discovery as failed.`,
            );
            discoverySuccess = false;
          }
        }
      }

      if (discoveredPieces.length > 0) {
        await db
          .insert(schema.pieces)
          .values(discoveredPieces)
          .onConflictDoUpdate({
            target: schema.pieces.name,
            set: {
              displayName: sql`EXCLUDED.display_name`,
              logoUrl: sql`EXCLUDED.logo_url`,
              packageName: sql`EXCLUDED.package_name`,
              version: sql`EXCLUDED.version`,
              updatedAt: new Date(),
            },
          });
        console.log(
          `  ✓ Upserted ${discoveredPieces.length} pieces into registry`,
        );

        if (discoverySuccess) {
          const discoveredPackageNames = discoveredPieces.map(
            (p) => p.packageName,
          );
          await db
            .update(schema.pieces)
            .set({ enabled: false })
            .where(
              notInArray(schema.pieces.packageName, discoveredPackageNames),
            );
          console.log('  ✓ Cleaned up removed pieces from registry');
        }
      } else {
        if (discoverySuccess && process.env.ALLOW_DISABLE_ALL === 'true') {
          console.warn(
            `  ⚠️  ALLOW_DISABLE_ALL is set. discoverySuccess=${String(discoverySuccess)}, discoveredPieces.length=${String(discoveredPieces.length)}. Disabling ALL pieces in registry.`,
          );
          await db.update(schema.pieces).set({ enabled: false });
          console.log('  ✓ Disabled all pieces (none discovered)');
        } else if (discoverySuccess) {
          console.warn(
            `  ⚠️  No pieces discovered but ALLOW_DISABLE_ALL is not set — skipping mass disable to avoid accidental data loss.`,
          );
        }
        console.log('  ℹ️ No pieces discovered.');
      }

      // 4. Seed Bootstrap Owner (User Request)
      const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
      const name = process.env.BOOTSTRAP_ADMIN_NAME;

      if (email && password && name) {
        const maskedEmail = email.replace(/(.{2}).*(@.*)/, '$1***$2');
        console.log(`  👤 Seeding bootstrap owner: ${maskedEmail}`);
        const bcrypt = await import('bcryptjs');
        const { v4: uuidv4 } = await import('uuid');

        // Check if user exists
        let user = await db.query.user.findFirst({
          where: eq(schema.user.email, email),
        });

        // Stable ID for transaction compatibility
        const userId = user?.id || uuidv4();
        const now = new Date();

        if (user) {
          console.log('    ℹ️  User already exists');

          // Ensure System Membership (Owner) for existing user
          const existingMember = await db.query.member.findFirst({
            where: (m, { and, eq }) =>
              and(eq(m.userId, userId), eq(m.organizationId, systemTenantId)),
          });

          if (!existingMember) {
            await db
              .insert(schema.member)
              .values({
                id: uuidv4(),
                userId: userId,
                organizationId: systemTenantId,
                role: config.ownerRoleId,
                createdAt: now,
              })
              .onConflictDoNothing();
            console.log('    ✓ System Owner membership created');
          }
        } else {
          const hashedPassword = await bcrypt.hash(password, 10);

          await db.transaction(async (tx) => {
            // Create User
            await tx.insert(schema.user).values({
              id: userId,
              email,
              name,
              emailVerified: true,
              createdAt: now,
              updatedAt: now,
              role: 'member', // Legacy fallback
            });

            // Create Account (Credential)
            await tx.insert(schema.account).values({
              id: uuidv4(),
              userId: userId,
              accountId: email,
              providerId: 'credential',
              password: hashedPassword,
              createdAt: now,
              updatedAt: now,
            });

            // Ensure System Membership (Owner) - Atomic with User Creation
            await tx.insert(schema.member).values({
              id: uuidv4(),
              userId: userId,
              organizationId: systemTenantId,
              role: config.ownerRoleId,
              createdAt: now,
            });
            console.log('    ✓ System Owner membership created');

            user = { id: userId } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
          });
          console.log('    ✓ User and Account created');
        }
      } else {
        console.log('  ⚠️  Skipping bootstrap user: Missing env vars');
      }

      console.log('  ✓ Seeding complete');
    } finally {
      await client.end();
    }
  }

  /**
   * Seed ABAC data for manual verification
   * Creates restricted_admin role with conditional permissions
   */
  async seedAbac(): Promise<void> {
    this.assertSafeEnvironment();
    console.log('🌱 Seeding ABAC data for verification...');

    await this.withDrizzle(async (db, schema) => {
      // 1. Ensure permissions exist
      await db
        .insert(schema.permission)
        .values([
          {
            id: 'users:read',
            resource: 'users',
            action: 'read',
            description: 'Read users',
          },
          {
            id: 'users:delete',
            resource: 'users',
            action: 'delete',
            description: 'Delete users',
          },
        ])
        .onConflictDoNothing();
      console.log('  ✓ Permissions "users:read", "users:delete" ensured');

      // 2. Create "restricted_admin" role
      await db
        .insert(schema.role)
        .values({
          id: 'restricted_admin',
          name: 'Restricted Admin',
          description: 'Can manage users but cannot delete Owners',
          isSystem: false,
        })
        .onConflictDoNothing();
      console.log('  ✓ Role "restricted_admin" created');

      // 3. Grant "users:read" (Global access)
      await db
        .insert(schema.rolePermission)
        .values({
          id: 'rp_restricted_read',
          roleId: 'restricted_admin',
          permissionId: 'users:read',
        })
        .onConflictDoNothing();
      console.log('  ✓ Granted "users:read"');

      // 4. Grant "users:delete" WITH ABAC CONDITION
      await db
        .insert(schema.rolePermission)
        .values({
          id: 'rp_restricted_delete',
          roleId: 'restricted_admin',
          permissionId: 'users:delete',
          conditions: {
            role: { $ne: 'owner' },
          } satisfies schema.AbacConditions,
        })
        .onConflictDoNothing();
      console.log(
        '  ✓ Granted "users:delete" with condition { role: { $ne: "owner" } }',
      );
    });
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
        .map((t) => `"${t.table_name.replaceAll('"', '""')}"`)
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

  // ─────────────────────────────────────────────────────────────────────────
  // Local dev fixture provisioning
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Derives metadata object based on appName.
   * For Salesforce connections, sets appProfile to 'revenova' to route to Revenova domain hooks.
   * For all other apps, returns empty metadata (default profile).
   */
  private deriveMetadata(appName: string): Record<string, unknown> {
    return appName === 'salesforce' ? { appProfile: 'revenova' } : {};
  }

  /**
   * Encrypts a string using AES-256-GCM — same algorithm as LocalCryptoAdapter.
   * Wire format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
   */
  private encryptFixture(plaintext: string, encryptionKey: string): string {
    const keyBuffer = Buffer.from(encryptionKey);
    if (keyBuffer.length !== 32) {
      throw new Error(
        `ENCRYPTION_KEY must be exactly 32 bytes, got ${keyBuffer.length}. ` +
          `Set a 32-character string in your .env file.`,
      );
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyBuffer, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Helper to initialize SqlDatabaseManager with correct schema, db, and client.
   * Ensures client.end() in a finally block.
   */
  private async withSchemaMgr<T>(
    cb: (mgr: import('@nexiom/dbmanager').TenantDatabaseManager) => Promise<T>,
  ): Promise<T> {
    const { TenantDatabaseManager } = await import('@nexiom/dbmanager');
    const { getDomainProvisioner } = await import('@nexiom/piece-framework');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { Pool } = await import('pg');
    const dbSchema = await import('./schema.js');
    const client = await this.getPgClient();

    try {
      const db = drizzle(client, { schema: dbSchema });
      const { dbUrl } = await this.resolvePgModule();
      const schemaMgr = new TenantDatabaseManager(
        db as unknown as import('@nexiom/database').DrizzleDb,
        (hostIdentifier: string) => {
          // Rehydrate credentials from DATABASE_URL
          // The hostIdentifier is just protocol://host:port, so we need to merge with credentials
          const parsedEnv = new URL(dbUrl);
          const parsedHost = new URL(hostIdentifier);

          // Build full DSN with credentials from DATABASE_URL and host from hostIdentifier
          const fullDsn = `${parsedHost.protocol}//${parsedEnv.username}:${parsedEnv.password}@${parsedHost.host}${parsedEnv.pathname}${parsedEnv.search}`;

          const pool = new Pool({
            connectionString: fullDsn,
            max: 20,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
          });
          return drizzle(pool, {
            schema: dbSchema,
          }) as unknown as import('@nexiom/database').DrizzleDb;
        },
        getDomainProvisioner,
      );
      return await cb(schemaMgr);
    } finally {
      await client.end();
    }
  }

  /**
   * Provision local dev fixture:
   *   1. Upserts one Salesforce + one QuickBooks connection under the system tenant.
   *   2. Creates `ws_{connectionId}` schemas (GATEWAY_ACTIVE plan) for each.
   *
   * Idempotent — safe to run multiple times. Skips connections that already exist.
   */
  async provisionLocal(): Promise<void> {
    this.assertSafeEnvironment();

    // Require an explicit opt-in flag OR confirm the DB host is local.
    const dbUrl = process.env.DATABASE_URL ?? '';
    const forceFlag = process.env.FORCE_PROVISION_LOCAL === 'true';
    if (!forceFlag) {
      let host: string | null = null;
      try {
        host = new URL(dbUrl).hostname;
      } catch {
        // unparseable URL — host stays null, treated as non-local below
      }
      // null  → parse failed (non-local)
      // ''    → Unix socket path in the URL (local)
      // other → compare against known local hostnames
      const isLocal =
        host === '' ||
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1';
      if (!isLocal) {
        throw new Error(
          `provisionLocal() refused: DATABASE_URL points to a non-local host ("${host ?? 'unparseable'}"). ` +
            `Set FORCE_PROVISION_LOCAL=true to override.`,
        );
      }
    }

    console.log('🔧 Provisioning local dev fixtures...\n');

    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error(
        'ENCRYPTION_KEY is not set. Add a 32-character string to your .env file.',
      );
    }

    const systemTenantId = process.env.SYSTEM_TENANT_ID;
    if (!systemTenantId) {
      throw new Error(
        'SYSTEM_TENANT_ID is not set. Run `db:seed` first to create the system tenant.',
      );
    }

    // ── Step 1: Derive host URL + tenant DB name ────────────────────────────
    let hostUrl: string;
    const tenantDbName = 'nexiom_tenant_system';
    try {
      const parsedUrl = new URL(
        process.env.DATABASE_URL ||
          'postgresql://user:password@localhost:5432/nexiom_global',
      );
      const auth = parsedUrl.username
        ? `${parsedUrl.username}${parsedUrl.password ? ':' + parsedUrl.password : ''}@`
        : '';
      hostUrl = `${parsedUrl.protocol}//${auth}${parsedUrl.hostname}${parsedUrl.port ? ':' + parsedUrl.port : ''}`;
    } catch (err) {
      const redactedUrl = process.env.DATABASE_URL
        ? process.env.DATABASE_URL.replace(/:\/\/[^@]*@/, '://***:***@')
        : '(not set)';
      console.warn(
        `⚠️  Failed to parse DATABASE_URL: ${redactedUrl}. Error: ${err instanceof Error ? err.message : String(err)}. Falling back to default.`,
      );
      hostUrl = 'postgresql://user:password@localhost:5432';
    }

    // ── Step 2: CREATE DATABASE nexiom_tenant_system + run tenant migrations ─
    console.log(`\n📦 Provisioning tenant database: ${tenantDbName}`);
    await this.createTenantDatabase(tenantDbName, hostUrl);

    // ── Step 3: Connect to global DB to register the tenant ─────────────────
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { Pool } = await import('pg');
    const dbSchema = await import('./schema.js');
    const globalClient = await this.getPgClient();
    const globalDb = drizzle(globalClient, { schema: dbSchema });

    // Register in global tenant_storage_registry
    const existReg = await globalDb
      .select()
      .from(dbSchema.tenantStorageRegistry)
      .where(eq(dbSchema.tenantStorageRegistry.tenantId, systemTenantId))
      .limit(1);

    if (!existReg[0]) {
      await globalDb.insert(dbSchema.tenantStorageRegistry).values({
        tenantId: systemTenantId,
        databaseName: tenantDbName,
        databaseHostUrl: hostUrl,
        regionContext: 'local',
      });
      console.log(`  ✓ Registered ${tenantDbName} in tenant_storage_registry`);
    } else {
      // Update host URL in case credentials changed
      await globalDb
        .update(dbSchema.tenantStorageRegistry)
        .set({ databaseName: tenantDbName, databaseHostUrl: hostUrl })
        .where(eq(dbSchema.tenantStorageRegistry.tenantId, systemTenantId));
      console.log(`  ✓ Updated tenant_storage_registry for ${tenantDbName}`);
    }

    // ── Step 4: Connect to tenant DB and write app_connection fixtures ───────
    const tenantUrl = `${hostUrl.replace(/\/$/, '')}/${tenantDbName}`;
    let tenantPool: Pool | undefined;

    try {
      tenantPool = new Pool({ connectionString: tenantUrl, max: 5 });
      const tenantDb = drizzle(tenantPool, { schema: dbSchema });

      const { SchemaPlan } = await import('@nexiom/dbmanager');
      const { TenantDatabaseManager } = await import('@nexiom/dbmanager');
      const { getDomainProvisioner } = await import('@nexiom/piece-framework');

      const schemaMgr = new TenantDatabaseManager(
        globalDb as unknown as import('@nexiom/database').DrizzleDb,
        (_hostIdentifier: string) => {
          const pool2 = new Pool({ connectionString: tenantUrl, max: 20 });
          return drizzle(pool2, {
            schema: dbSchema,
          }) as unknown as import('@nexiom/database').DrizzleDb;
        },
        getDomainProvisioner,
      );

      const fixtures = [
        {
          id: '00000000-0000-0000-0000-000000000001',
          appName: 'salesforce',
          externalId: 'dev-salesforce',
          displayName: 'Dev Salesforce',
          metadata: this.deriveMetadata('salesforce'),
          credentials: {
            clientId: 'dev-sf-client-id',
            clientSecret: 'dev-sf-client-secret',
            accessToken: 'dev-sf-access-token',
            refreshToken: 'dev-sf-refresh-token',
            data: { instance_url: 'https://test.salesforce.com' },
          },
        },
        {
          id: '00000000-0000-0000-0000-000000000002',
          appName: 'quickbooks',
          externalId: 'dev-quickbooks',
          displayName: 'Dev QuickBooks',
          metadata: this.deriveMetadata('quickbooks'),
          credentials: {
            clientId: 'dev-qb-client-id',
            clientSecret: 'dev-qb-client-secret',
            accessToken: 'dev-qb-access-token',
            refreshToken: 'dev-qb-refresh-token',
            data: { realmId: 'dev-realm-id' },
          },
        },
      ] as const;

      const { getWorkspaceSchemaName } = await import('@nexiom/dbmanager');

      for (const fixture of fixtures) {
        const encryptedValue = this.encryptFixture(
          JSON.stringify(fixture.credentials),
          encryptionKey,
        );

        // Write app_connection into the TENANT DB (not global)
        const [inserted] = await tenantDb
          .insert(dbSchema.appConnections)
          .values({
            id: fixture.id,
            tenantId: systemTenantId,
            appName: fixture.appName,
            externalId: fixture.externalId,
            displayName: fixture.displayName,
            authType: 'OAUTH2',
            value: encryptedValue,
            metadata: fixture.metadata,
            status: 'INACTIVE',
          })
          .onConflictDoUpdate({
            target: [
              dbSchema.appConnections.tenantId,
              dbSchema.appConnections.externalId,
            ],
            set: {
              value: encryptedValue,
              displayName: fixture.displayName,
              appName: fixture.appName,
              authType: 'OAUTH2',
              metadata: fixture.metadata,
              status: sql`CASE
                WHEN ${dbSchema.appConnections.status} IN ('ACTIVE', 'REVOKED')
                THEN ${dbSchema.appConnections.status}
                ELSE 'INACTIVE'
              END`,
            },
          })
          .returning();

        if (!inserted) {
          throw new Error(
            `Upsert returned no row for externalId=${fixture.externalId}`,
          );
        }

        const schemaName = getWorkspaceSchemaName(
          inserted.id,
          inserted.appName,
        );

        // Provision workspace pipeline schemas inside the tenant DB
        await schemaMgr.applyPlan(
          systemTenantId,
          schemaName,
          SchemaPlan.OUTBOUND_ACTIVE,
        );

        // Mark connection ACTIVE in the tenant DB
        await tenantDb
          .update(dbSchema.appConnections)
          .set({ status: 'ACTIVE' })
          .where(eq(dbSchema.appConnections.id, inserted.id));

        console.log(
          `  ✓ ${inserted.displayName} → ${inserted.id} (schema: ${schemaName})`,
        );
      }

      console.log('\n✅ Local dev fixtures provisioned.');
      console.log(
        '   To replace credentials, use the encrypt CLI helper (e.g. pnpm db:encrypt-credential)\n' +
          '   and update app_connection.value with the resulting ciphertext.\n' +
          '   Do NOT edit the value column manually — it holds AES-GCM ciphertext.',
      );
    } finally {
      if (tenantPool) {
        await tenantPool.end();
      }
      await globalClient.end();
    }
  }

  /**
   * Upgrades a connection's physical schema to GATEWAY_ACTIVE,
   * creating the inbound_gateway (L1) table so webhook payloads can be ingested.
   *
   * Used for local development and testing when a stitch has not yet been
   * activated through the normal UI flow.
   *
   * @param schemaName - The physical schema name (e.g. 'ws_salesforce_98b64cffa1b61b2c')
   */
  async provisionGateway(schemaName: string): Promise<void> {
    this.assertSafeEnvironment();
    console.log(`🔧 Applying GATEWAY_ACTIVE to schema: ${schemaName}...\n`);

    const { SchemaPlan } = await import('@nexiom/dbmanager');

    await this.withSchemaMgr(async (schemaMgr) => {
      const systemTenantId = process.env.SYSTEM_TENANT_ID;
      if (!systemTenantId) throw new Error('SYSTEM_TENANT_ID is required');
      await schemaMgr.applyPlan(
        systemTenantId,
        schemaName,
        SchemaPlan.GATEWAY_ACTIVE,
      );
      console.log(`  ✓ Schema "${schemaName}" upgraded to GATEWAY_ACTIVE`);
      console.log(
        '  ✓ inbound_gateway table is now ready for webhook ingestion',
      );
    });
  }

  /**
   * Upgrades a connection's physical schema to OUTBOUND_ACTIVE natively
   */
  async provisionOutbound(schemaName: string): Promise<void> {
    this.assertSafeEnvironment();
    console.log(`🔧 Applying OUTBOUND_ACTIVE to schema: ${schemaName}...\n`);

    const { SchemaPlan } = await import('@nexiom/dbmanager');

    await this.withSchemaMgr(async (schemaMgr) => {
      const systemTenantId = process.env.SYSTEM_TENANT_ID;
      if (!systemTenantId) throw new Error('SYSTEM_TENANT_ID is required');
      await schemaMgr.applyPlan(
        systemTenantId,
        schemaName,
        SchemaPlan.OUTBOUND_ACTIVE,
      );
      console.log(`  ✓ Schema "${schemaName}" upgraded to OUTBOUND_ACTIVE`);
    });
  }

  /**
   * Discovers all tenant schemas (ws_*) and migrates them to OUTBOUND_ACTIVE state.
   * Reapplies all provisioner layers to ensure existing tenants receive:
   * - active_sync_locks table
   * - schema_name columns on outbox tables
   * - sync_log partial indexes
   * Safe to run on a live database — all changes are guarded by IF EXISTS / IF NOT EXISTS.
   */
  async migrateAllSchemas(): Promise<void> {
    console.log(
      '🔧 Migrating all tenant schemas to OUTBOUND_ACTIVE state...\n',
    );

    await this.withSchemaMgr(async (schemaMgr) => {
      const client = await this.getPgClient();
      try {
        const systemTenantId = process.env.SYSTEM_TENANT_ID;
        if (!systemTenantId) throw new Error('SYSTEM_TENANT_ID is required');
        const result = await client.query<{ schema_name: string }>(`
          SELECT schema_name
          FROM information_schema.schemata
          WHERE schema_name LIKE 'ws_%'
          ORDER BY schema_name;
        `);

        if (result.rows.length === 0) {
          console.log('  ℹ️  No tenant schemas found.');
          return;
        }

        const failures: Array<{ schema: string; error: string }> = [];

        for (const { schema_name } of result.rows) {
          try {
            await schemaMgr.migrateToOutboundActive(
              systemTenantId,
              schema_name,
            );
            console.log(`  ✓ ${schema_name}`);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`  ✗ ${schema_name}:`, errorMsg);
            failures.push({ schema: schema_name, error: errorMsg });
          }
        }

        if (failures.length > 0) {
          console.log(
            `\n⚠️  Migration completed with ${failures.length} failure(s) out of ${result.rows.length} schema(s).`,
          );
          console.log('Failed schemas:');
          for (const { schema, error } of failures) {
            console.log(`  - ${schema}: ${error}`);
          }
          throw new Error(
            `Migration failed for ${failures.length} schema(s). See logs above for details.`,
          );
        }

        console.log(
          `\n✅ All ${result.rows.length} tenant schema(s) migrated successfully.`,
        );
      } finally {
        await client.end();
      }
    });
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
      const permIds = perms
        .map((p) => p.permissionId)
        .sort((a: string, b: string) => a.localeCompare(b));

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
   * Seeds the local dev mapping for TMS_CARRIER -> QuickBooks Vendor
   */
  async seedMapping(): Promise<void> {
    this.assertSafeEnvironment();
    console.log(
      '🌱 Seeding local field mapping (TMS_CARRIER -> QuickBooks Vendor)...',
    );

    await this.withDrizzle(async (db, schema) => {
      const { eq, and } = await import('drizzle-orm');

      // Look up the deterministic fixtures created by provisionLocal()
      const salesforceConn = await db
        .select()
        .from(schema.appConnections)
        .where(
          eq(schema.appConnections.id, '00000000-0000-0000-0000-000000000001'),
        )
        .limit(1);
      const qbConn = await db
        .select()
        .from(schema.appConnections)
        .where(
          eq(schema.appConnections.id, '00000000-0000-0000-0000-000000000002'),
        )
        .limit(1);

      if (!salesforceConn[0] || !qbConn[0]) {
        throw new Error(
          'No local connections found. Run pnpm db:provision:local first.',
        );
      }

      // Check if a workspace exists
      // Note: This uses an unfiltered query which may pick any existing workspace.
      // For deterministic behavior, ensure a seeded workspace exists via db:seed.
      const workspaces = await db.select().from(schema.uiWorkspaces).limit(1);
      if (workspaces.length === 0) {
        throw new Error('No workspace found. Run pnpm db:seed first.');
      }

      // Check for existing stitch
      const stitches = await db
        .select()
        .from(schema.integrationStitches)
        .where(
          and(
            eq(
              schema.integrationStitches.srcConnectionId,
              salesforceConn[0].id,
            ),
            eq(schema.integrationStitches.destConnectionId, qbConn[0].id),
          ),
        )
        .limit(1);

      let stitchId;
      if (stitches.length === 0) {
        const [newStitch] = await db
          .insert(schema.integrationStitches)
          .values({
            name: 'Revenova to QuickBooks Local Sync',
            orgId: workspaces[0].orgId,
            workspaceId: workspaces[0].id,
            srcConnectionId: salesforceConn[0].id,
            destConnectionId: qbConn[0].id,
            sourceObject: 'Account',
            targetObject: 'Vendor',
          })
          .returning();
        stitchId = newStitch.id;
        console.log(`  ✓ Created new integration stitch: ${stitchId}`);
      } else {
        stitchId = stitches[0].id;
        console.log(`  ✓ Found existing integration stitch: ${stitchId}`);
      }

      // Extract mapping rules into a constant to avoid duplication
      const carrierMappingRules = [
        { srcPath: 'displayName', destPath: 'DisplayName' },
        { srcPath: 'displayName', destPath: 'CompanyName' },
        { srcPath: 'tp.mcNumber', destPath: 'GivenName' },
        { srcPath: 'remitTo.billingStreet', destPath: 'BillAddr.Line1' },
        { srcPath: 'remitTo.billingCity', destPath: 'BillAddr.City' },
        {
          srcPath: 'remitTo.billingState',
          destPath: 'BillAddr.CountrySubDivisionCode',
        },
        {
          srcPath: 'remitTo.billingPostalCode',
          destPath: 'BillAddr.PostalCode',
        },
        { srcPath: 'remitTo.billingCountry', destPath: 'BillAddr.Country' },
        { srcPath: 'billingStreet', destPath: 'ShipAddr.Line1' },
        { srcPath: 'billingCity', destPath: 'ShipAddr.City' },
        {
          srcPath: 'billingState',
          destPath: 'ShipAddr.CountrySubDivisionCode',
        },
        { srcPath: 'billingPostalCode', destPath: 'ShipAddr.PostalCode' },
        { srcPath: 'billingCountry', destPath: 'ShipAddr.Country' },
        { srcPath: 'phone', destPath: 'PrimaryPhone.FreeFormNumber' },
        { srcPath: 'fax', destPath: 'Fax.FreeFormNumber' },
      ];

      // Insert or Update the field mapping rule
      await db
        .insert(schema.fieldMappings)
        .values({
          stitchId: stitchId,
          sourceCanonical: 'TMS_CARRIER',
          mappingRules: carrierMappingRules,
        })
        .onConflictDoUpdate({
          target: [
            schema.fieldMappings.stitchId,
            schema.fieldMappings.sourceCanonical,
          ],
          set: {
            mappingRules: carrierMappingRules,
          },
        });

      console.log(
        '  ✓ Inserted dynamic JSON field mapping into field_mapping table!',
      );
      console.log('✅ Local Pipeline Mapping Seeded.');
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
