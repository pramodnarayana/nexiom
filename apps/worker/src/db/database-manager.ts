import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, randomBytes } from "node:crypto";
import { Client } from "pg";
import { sql, eq, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

/**
 * Enterprise-grade database management utility
 * Provides clean TypeScript interface for database operations
 *
 * Note: Uses execSync to avoid tsx transpilation issues with decorators
 */
export class DatabaseManager {
  private readonly ALLOWED_ENVS = ["development", "test", "local"];

  // Cache pg module to avoid repeated dynamic imports
  private static cachedPg: typeof import("pg") | null = null;

  // ... (truncating internal methods for brevity, assuming they are unchanged in this block selection) ...

  // Reset method omitted from replacement range to focus on withDrizzle and imports

  /** Critical permissions to verify in debug output. */
  private static readonly CRITICAL_PERMISSIONS = [
    "system_users:create",
    "users:create",
    "dashboard:view",
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
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const dbSchema = await import("./schema.js");
    const client = await this.getPgClient();

    try {
      const db = drizzle(client, { schema: dbSchema });
      return await callback(db, dbSchema);
    } finally {
      await client.end();
    }
  }

  private async resolvePgModule(): Promise<{
    PgClient: typeof import("pg").Client;
    dbUrl: string;
  }> {
    // Use cached pg module or load it once
    DatabaseManager.cachedPg ??= await import("pg");
    const { Client: PgClient } = DatabaseManager.cachedPg;

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error("DATABASE_URL is not defined");
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
   * Check if current environment allows destructive operations.
   * Also validates that DATABASE_URL points to a local host so destructive
   * operations can never accidentally reach a remote/production database.
   */
  private assertSafeEnvironment(allowForceProvision = false): void {
    const env = process.env.NODE_ENV;
    if (!env || !this.ALLOWED_ENVS.includes(env)) {
      throw new Error(
        `Destructive database operations only allowed in: ${this.ALLOWED_ENVS.join(", ")}. Current: ${env || "unset"}`,
      );
    }

    if (allowForceProvision && process.env.FORCE_PROVISION_LOCAL === "true") {
      return;
    }

    // Guard against accidental destructive ops against remote databases even
    // when NODE_ENV is permissive. Mirrors the host check in provisionLocal().
    // Skip if DATABASE_URL is absent — resolvePgModule() will throw the canonical
    // "DATABASE_URL is not defined" error when the connection is actually attempted.
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      let host: string | null = null;
      try {
        host = new URL(dbUrl).hostname;
      } catch {
        // unparseable URL — treat as non-local
      }
      // "" → Unix socket (local); known loopback aliases are also local.
      const isRemote =
        host !== "" &&
        host !== "localhost" &&
        host !== "127.0.0.1" &&
        host !== "::1";
      if (isRemote) {
        throw new Error(
          `Destructive database operations refused: DATABASE_URL points to a non-local host ("${host ?? "unparseable"}"). ` +
            `These operations are only permitted against a local database.`,
        );
      }
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
    console.log("🗑️  Dropping all schemas...");

    // Reuse single connection for all operations
    const client = await this.getPgClient();

    try {
      // Drop tenant (ws_*) schemas first so foreign keys don't block public
      const tenantSchemas = await this.querySql<{ nspname: string }>(
        `SELECT nspname FROM pg_namespace WHERE left(nspname, 3) = 'ws_' ORDER BY nspname;`,
        client,
      );
      for (const { nspname } of tenantSchemas) {
        const escapedNsp = nspname.replaceAll('"', '""');
        await this.execSql(
          `DROP SCHEMA IF EXISTS "${escapedNsp}" CASCADE;`,
          client,
        );
        console.log(`  ✓ Dropped tenant schema: ${nspname}`);
      }

      // Drop drizzle schema (migration tracking)
      await this.execSql("DROP SCHEMA IF EXISTS drizzle CASCADE;", client);
      console.log("  ✓ Dropped drizzle schema");

      // Drop public schema (all tables)
      await this.execSql("DROP SCHEMA IF EXISTS public CASCADE;", client);
      console.log("  ✓ Dropped public schema");

      // Recreate public schema
      await this.execSql("CREATE SCHEMA public;", client);
      await this.execSql("GRANT ALL ON SCHEMA public TO PUBLIC;", client);
      console.log("  ✓ Recreated public schema");
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
    console.log("🔨 Running centralized migrations...");
    let rootCwd: string;
    if (typeof __dirname !== "undefined") {
      rootCwd = path.resolve(__dirname, "../../../../");
    } else {
      rootCwd = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../../",
      );
    }
    // Orchestrate migrations from the root monorepo script
    execSync("pnpm db:migrate", {
      stdio: "inherit",
      cwd: rootCwd,
      env: { ...process.env, FORCE_COLOR: "1" },
    });

    console.log("  ✓ Centralized migrations complete");
  }

  /**
   * Seed database with initial data
   * Creates system organization and seeds RBAC data
   */
  async seed(): Promise<void> {
    this.assertSafeEnvironment();
    console.log("🌱 Seeding database...");

    const { drizzle } = await import("drizzle-orm/node-postgres");
    const schema = await import("./schema.js");
    const { seedSystemRbac } =
      await import("@nexiom/identity/utils/rbac-seeding");
    const {
      getRequiredOwnerRoleId,
      getRequiredAdminRoleId,
      getRequiredMemberRoleId,
      getRequiredSystemTenantId,
    } = await import("../constants.js");

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
          name: "Nexiom Platform",
          slug: "system",
          isSystem: true,
        });
        console.log("  ✓ System organization created");
      }

      // 2. Seed RBAC data
      const config = {
        ownerRoleId: getRequiredOwnerRoleId(),
        adminRoleId: getRequiredAdminRoleId(),
        memberRoleId: getRequiredMemberRoleId(),
        systemTenantId,
      };

      // Create a separate DB instance with identity schema for seedSystemRbac
      const identitySchema = await import("@nexiom/identity/schema");
      const identityDb = drizzle(client, { schema: identitySchema });
      await seedSystemRbac(identityDb, config, console);

      // 3. Seed Bootstrap Owner (User Request)
      const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
      const name = process.env.BOOTSTRAP_ADMIN_NAME;

      if (email && password && name) {
        const maskedEmail = email.replace(/(.{2}).*(@.*)/, "$1***$2");
        console.log(`  👤 Seeding bootstrap owner: ${maskedEmail}`);
        const bcrypt = await import("bcryptjs");
        const { v4: uuidv4 } = await import("uuid");

        // Check if user exists
        let user = await db.query.user.findFirst({
          where: eq(schema.user.email, email),
        });

        // Stable ID for transaction compatibility
        const userId = user?.id || uuidv4();
        const now = new Date();

        if (user) {
          console.log("    ℹ️  User already exists");

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
            console.log("    ✓ System Owner membership created");
          } else if (existingMember.role !== config.ownerRoleId) {
            await db
              .update(schema.member)
              .set({ role: config.ownerRoleId })
              .where(sql`${schema.member.id} = ${existingMember.id}`);
            console.log("    ✓ System Owner membership role restored");
          }

          const hashedPassword = await bcrypt.hash(password, 10);
          await db
            .insert(schema.account)
            .values({
              id: uuidv4(),
              userId: userId,
              accountId: email,
              providerId: "credential",
              password: hashedPassword,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [schema.account.providerId, schema.account.accountId],
              set: {
                password: hashedPassword,
                userId: userId,
                updatedAt: now,
              },
            });
          console.log("    ✓ System Owner credential updated");
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
              role: "member", // Legacy fallback
            });

            // Create Account (Credential)
            await tx.insert(schema.account).values({
              id: uuidv4(),
              userId: userId,
              accountId: email,
              providerId: "credential",
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
            console.log("    ✓ System Owner membership created");

            user = { id: userId } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
          });
          console.log("    ✓ User and Account created");
        }
      } else {
        console.log("  ⚠️  Skipping bootstrap user: Missing env vars");
      }

      console.log("  ✓ Seeding complete");
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
    console.log("🌱 Seeding ABAC data for verification...");

    await this.withDrizzle(async (db, schema) => {
      // 1. Ensure permissions exist
      await db
        .insert(schema.permission)
        .values([
          {
            id: "users:read",
            resource: "users",
            action: "read",
            description: "Read users",
          },
          {
            id: "users:delete",
            resource: "users",
            action: "delete",
            description: "Delete users",
          },
        ])
        .onConflictDoNothing();
      console.log('  ✓ Permissions "users:read", "users:delete" ensured');

      // 2. Create "restricted_admin" role
      await db
        .insert(schema.role)
        .values({
          id: "restricted_admin",
          name: "Restricted Admin",
          description: "Can manage users but cannot delete Owners",
          isSystem: false,
        })
        .onConflictDoNothing();
      console.log('  ✓ Role "restricted_admin" created');

      // 3. Grant "users:read" (Global access)
      await db
        .insert(schema.rolePermission)
        .values({
          id: "rp_restricted_read",
          roleId: "restricted_admin",
          permissionId: "users:read",
        })
        .onConflictDoNothing();
      console.log('  ✓ Granted "users:read"');

      // 4. Grant "users:delete" WITH ABAC CONDITION
      await db
        .insert(schema.rolePermission)
        .values({
          id: "rp_restricted_delete",
          roleId: "restricted_admin",
          permissionId: "users:delete",
          conditions: {
            role: { $ne: "owner" },
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
    console.log("🧹 Truncating all tables...");

    const client = await this.getPgClient();

    try {
      // ── public schema tables ────────────────────────────────────────────────
      const publicTables = await this.querySql<{
        table_schema: string;
        table_name: string;
      }>(
        `SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`,
        client,
      );

      if (publicTables.length > 0) {
        const quotedPublic = publicTables
          .map((t) => `"public"."${t.table_name.replaceAll('"', '""')}"`)
          .join(", ");
        await this.execSql(`TRUNCATE TABLE ${quotedPublic} CASCADE;`, client);
        console.log(`  ✓ Truncated ${publicTables.length} public tables`);
      } else {
        console.log("  ℹ️  No tables found in public schema to truncate");
      }

      // ── tenant (ws_*) schema tables ─────────────────────────────────────────
      const tenantSchemas = await this.querySql<{ nspname: string }>(
        `SELECT nspname FROM pg_namespace WHERE left(nspname, 3) = 'ws_' ORDER BY nspname;`,
        client,
      );

      for (const { nspname } of tenantSchemas) {
        const escapedNsp = nspname.replaceAll('"', '""');
        const tenantTables = await this.querySql<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = '${nspname.replaceAll("'", "''")}' AND table_type = 'BASE TABLE';`,
          client,
        );

        if (tenantTables.length > 0) {
          const quotedTenant = tenantTables
            .map(
              (t) => `"${escapedNsp}"."${t.table_name.replaceAll('"', '""')}"`,
            )
            .join(", ");
          await this.execSql(`TRUNCATE TABLE ${quotedTenant} CASCADE;`, client);
          console.log(
            `  ✓ Truncated ${tenantTables.length} tables in ${nspname}`,
          );
        }
      }
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
    console.log("🆕 Fresh database install...\n");

    await this.dropAll();
    console.log();

    this.migrate();
    console.log();

    await this.seed();
    console.log();

    console.log("✅ Fresh install complete!");
  }

  /**
   * Reset: Truncate + Seed
   * Clears data but preserves schema
   */
  async reset(): Promise<void> {
    this.assertSafeEnvironment();
    console.log("🔄 Resetting database...\n");

    await this.truncateAll();
    console.log();

    await this.seed();
    console.log();

    console.log("✅ Reset complete!");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Local dev fixture provisioning
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Derives metadata object based on appName.
   * For Salesforce connections, sets appProfile to 'revenova'.
   * For Quickbooks, sets appProfile to 'online'.
   */
  private deriveMetadata(appName: string): Record<string, unknown> {
    const profiles: Record<string, string> = {
      salesforce: "revenova",
      quickbooks: "online",
    };
    const appProfile = profiles[appName] ?? "standard";
    return { appProfile };
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
    const cipher = createCipheriv("aes-256-gcm", keyBuffer, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
  }

  /**
   * Provision local dev fixture:
   *   1. Upserts one Salesforce + one QuickBooks connection under the system tenant.
   *   2. Creates `ws_{dataSourceId}` schemas (GATEWAY_ACTIVE plan) for each.
   *
   * Idempotent — safe to run multiple times. Skips connections that already exist.
   */
  async provisionLocal(): Promise<void> {
    this.assertSafeEnvironment(true);

    // Require an explicit opt-in flag OR confirm the DB host is local.
    const dbUrl = process.env.DATABASE_URL ?? "";
    const forceFlag = process.env.FORCE_PROVISION_LOCAL === "true";
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
        host === "" ||
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1";
      if (!isLocal) {
        throw new Error(
          `provisionLocal() refused: DATABASE_URL points to a non-local host ("${host ?? "unparseable"}"). ` +
            `Set FORCE_PROVISION_LOCAL=true to override.`,
        );
      }
    }

    console.log("🔧 Provisioning local dev fixtures...\n");

    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error(
        "ENCRYPTION_KEY is not set. Add a 32-character string to your .env file.",
      );
    }

    const systemTenantId = process.env.SYSTEM_TENANT_ID;
    if (!systemTenantId) {
      throw new Error(
        "SYSTEM_TENANT_ID is not set. Run `db:seed` first to create the system tenant.",
      );
    }

    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { TenantDatabaseManager } = await import("@nexiom/dbmanager");
    const { SchemaPlan } = await import("@nexiom/dbmanager");
    const client = await this.getPgClient();

    // Track all tenant Pools created by dbFactory so we can close them after provisioning
    const tenantPools: Array<import("pg").Pool> = [];

    try {
      const db = drizzle(client, { schema });
      const { Pool } = await import("pg");
      const { ApplicationLoaderService, PipelineHookBrokerService } =
        await import("@nexiom/engine");

      // Instantiate the loader directly — this is a CLI script, not in NestJS DI.
      // The loader reads from SHARD_APPLICATION_PATH and caches dynamically imported modules.
      const loaderInstance = new ApplicationLoaderService();
      const broker = new PipelineHookBrokerService(loaderInstance);

      // Build a domainProvisionerResolver function that matches the TenantDatabaseManager interface:
      //   (appName: string, appProfile: string) => ((db, schemaName) => Promise<void>) | undefined
      const domainProvisionerResolver = (
        appName: string,
        appProfile: string,
      ) => {
        return async (
          tenantDb: import("@nexiom/database").DrizzleDb,
          schemaName: string,
        ) => {
          try {
            await broker.provisionDomain(
              appName,
              appProfile,
              tenantDb,
              schemaName,
            );
          } catch (provisionErr) {
            console.error(
              `domainProvisionerResolver: broker.provisionDomain failed for appName=${appName}/${appProfile}, schemaName=${schemaName}:`,
              provisionErr instanceof Error
                ? provisionErr.message
                : String(provisionErr),
            );
            throw provisionErr;
          }
        };
      };

      const schemaMgr = new TenantDatabaseManager(
        db as unknown as import("@nexiom/database").DrizzleDb,
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
          tenantPools.push(pool);
          return drizzle(pool, {
            schema,
          }) as unknown as import("@nexiom/database").DrizzleDb;
        },
        domainProvisionerResolver,
      );

      const fixtures = [
        {
          id: "00000000-0000-0000-0000-000000000001",
          appName: "salesforce",
          externalId: "dev-salesforce",
          displayName: "Dev Salesforce",
          credentials: {
            clientId: "dev-sf-client-id",
            clientSecret: "dev-sf-client-secret",
            accessToken: "dev-sf-access-token",
            refreshToken: "dev-sf-refresh-token",
            data: { instance_url: "https://test.salesforce.com" },
          },
        },
        {
          id: "00000000-0000-0000-0000-000000000002",
          appName: "quickbooks",
          externalId: "dev-quickbooks",
          displayName: "Dev QuickBooks",
          credentials: {
            clientId: "dev-qb-client-id",
            clientSecret: "dev-qb-client-secret",
            accessToken: "dev-qb-access-token",
            refreshToken: "dev-qb-refresh-token",
            data: { realmId: "dev-realm-id" },
          },
        },
      ] as const;

      for (const fixture of fixtures) {
        const encryptedValue = this.encryptFixture(
          JSON.stringify(fixture.credentials),
          encryptionKey,
        );

        console.log(
          `  ℹ️  Provisioning connection ${fixture.appName} (preserving secrets if exists)`,
        );

        const { getWorkspaceSchemaName } = await import("@nexiom/dbmanager");
        const schemaName = getWorkspaceSchemaName(fixture.id, fixture.appName);

        await db.transaction(async (tx) => {
          const existRes = await tx
            .select()
            .from(schema.dataSources)
            .where(sql`${schema.dataSources.id} = ${fixture.id}`)
            .limit(1);
          const existing = existRes[0];

          if (!existing) {
            await tx.insert(schema.dataSources).values({
              id: fixture.id,
              tenantId: systemTenantId,
              appName: fixture.appName,
              externalId: fixture.externalId,
              displayName: fixture.displayName,
              metadata: this.deriveMetadata(fixture.appName),
            });
            await tx.insert(schema.credentials).values({
              dataSourceId: fixture.id,
              authType: "OAUTH2",
              value: encryptedValue,
              status: "INACTIVE",
            });
          } else {
            await tx
              .update(schema.dataSources)
              .set({
                metadata: this.deriveMetadata(fixture.appName),
              })
              .where(sql`${schema.dataSources.id} = ${fixture.id}`);

            await tx
              .insert(schema.credentials)
              .values({
                dataSourceId: fixture.id,
                authType: "OAUTH2",
                value: encryptedValue,
                status: "INACTIVE",
              })
              .onConflictDoUpdate({
                target: [schema.credentials.dataSourceId],
                set: {
                  value: encryptedValue,
                  status: "INACTIVE",
                },
              });
          }

          // Seed the tenant_storage_registry to map the tenant to its physical database.
          // In a real environment, this is created when the tenant signs up.
          // For local dev, we derive a sanitized host identifier (protocol-qualified) and avoid persisting credentials.
          let dbName = "nexiom_local";
          let hostIdentifier = "postgresql://localhost:5432";
          if (process.env.DATABASE_URL) {
            try {
              const parsedUrl = new URL(process.env.DATABASE_URL);
              const pathname = parsedUrl.pathname.replace(/^\/+|\/+$/g, "");
              if (pathname) {
                const segments = pathname.split("/");
                dbName = segments[segments.length - 1] || dbName;
              }
              // If pathname is empty, keep the default dbName instead of using parsedUrl.host
              // Build full protocol-qualified URL with host and port, no credentials or pathname
              hostIdentifier = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.port ? ":" + parsedUrl.port : ""}`;
            } catch {
              // Fallback to safe default for invalid/Unix-socket-style URLs
              dbName = "nexiom_local";
              hostIdentifier = "postgresql://localhost:5432";
            }
          }

          const existReg = await tx
            .select()
            .from(schema.tenantStorageRegistry)
            .where(
              sql`${schema.tenantStorageRegistry.tenantId} = ${systemTenantId}`,
            )
            .limit(1);

          if (!existReg[0]) {
            // Insert registry entry first
            await tx.insert(schema.tenantStorageRegistry).values({
              tenantId: systemTenantId,
              databaseName: dbName,
              databaseHostUrl: hostIdentifier,
              regionContext: "local",
            });
          }
        });

        // Now apply schema plan outside the committed transaction
        await schemaMgr.applyPlan(
          systemTenantId,
          schemaName,
          SchemaPlan.OUTBOUND_ACTIVE,
        );

        // Update connection to ACTIVE status in a new transaction
        await db.transaction(async (tx2) => {
          await tx2
            .update(schema.credentials)
            .set({ status: "ACTIVE" })
            .where(sql`${schema.credentials.dataSourceId} = ${fixture.id}`);
        });

        console.log(
          `  ✓ ${fixture.displayName} → ${fixture.id} (schema: ${schemaName})`,
        );
      }

      console.log("\n✅ Local dev fixtures provisioned.");
      console.log(
        "   To replace credentials, use the encrypt CLI helper (e.g. pnpm db:encrypt-credential)\n" +
          "   and update app_connection.value with the resulting ciphertext.\n" +
          "   Do NOT edit the value column manually — it holds AES-GCM ciphertext.",
      );
    } finally {
      // Close all tenant Pools created during provisioning (best-effort)
      const poolCloseResults = await Promise.allSettled(
        tenantPools.map((pool) => pool.end()),
      );

      // Log any pool closure failures but continue
      poolCloseResults.forEach((result, idx) => {
        if (result.status === "rejected") {
          console.error(
            `  ⚠️  Failed to close tenant pool ${idx}: ${result.reason}`,
          );
        }
      });

      await client.end();
    }
  }

  /**
   * Debug RBAC permissions for a role
   */
  async debugPermissions(roleName: string): Promise<void> {
    console.log(`🔍 Debugging permissions for role: ${roleName}...`);

    await this.withDrizzle(async (db, schema) => {
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
      console.log("\n  Critical Check:");
      for (const c of critical) {
        const has = permIds.includes(c);
        console.log(`    ${has ? "✅" : "❌"} ${c}`);
      }
    });
  }

  /**
   * Check permissions for a specific user (by ID or Email)
   */
  async checkUserPermissions(identifier: string): Promise<void> {
    console.log(`🔍 Checking permissions for user: ${identifier}...`);

    await this.withDrizzle(async (db, schema) => {
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
        await import("@nexiom/identity/utils/role-normalization");

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
        console.log("  Memberships: None");
      }

      console.log(`\n  Effective Permissions (${allPermissions.size}):`);
      const sortedPerms = Array.from(allPermissions).sort((a, b) =>
        a.localeCompare(b),
      );
      for (const p of sortedPerms) console.log(`    - ${p}`);

      const critical = DatabaseManager.CRITICAL_PERMISSIONS;
      console.log("\n  Critical Capability Check:");
      for (const c of critical) {
        const has = allPermissions.has(c);
        console.log(`    ${has ? "✅" : "❌"} ${c}`);
      }
    });
  }
}
