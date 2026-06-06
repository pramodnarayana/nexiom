import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { randomBytes, createCipheriv } from 'node:crypto';
import { EnvironmentGuardService } from './environment-guard.service.js';
import { PgConnectionPool } from '../infrastructure/pg-connection.pool.js';
import { TenantSchemaService } from './tenant-schema.service.js';
import { sql, eq } from 'drizzle-orm';
import type { Pool } from 'pg';

// Module-level cache for tenant pools to prevent connection leaks
const tenantPoolCache = new Map<
  string,
  { pool: Pool; drizzle: import('@soopa/database').DrizzleDb }
>();

@Injectable()
export class DevSandboxProvisionerService implements OnModuleDestroy {
  constructor(
    private readonly environmentGuard: EnvironmentGuardService,
    private readonly connectionPool: PgConnectionPool,
    private readonly tenantSchema: TenantSchemaService,
  ) {}

  async onModuleDestroy() {
    // Close all cached tenant pools to prevent connection leaks
    for (const [cacheKey, cached] of tenantPoolCache.entries()) {
      try {
        await cached.pool.end();
      } catch (err) {
        console.warn(
          `Failed to close tenant pool for ${cacheKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    tenantPoolCache.clear();
  }

  private deriveMetadata(appName: string): Record<string, unknown> {
    if (appName === 'salesforce') {
      return { instance_url: 'https://test.salesforce.com' };
    }
    return { realmId: 'dev-realm-id' };
  }

  encryptFixture(plaintext: string, encryptionKey: string): string {
    const keyBuffer = Buffer.from(encryptionKey, 'utf8');
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
   * Provision local dev fixture:
   *   1. Upserts one Salesforce + one QuickBooks connection under the system tenant.
   *   2. Creates `ws_{dataSourceId}` schemas (GATEWAY_ACTIVE plan) for each.
   *
   * Idempotent — safe to run multiple times. Skips connections that already exist.
   */
  async provisionLocal(): Promise<void> {
    this.environmentGuard.assertSafeEnvironment();

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

    // Generate a dedicated, stable UUID for the local dev customer to perfectly mimic production.
    const devTenantId = 'e2b3c4d5-6a7b-8c9d-0e1f-2a3b4c5d6e7f';

    // ── Step 1: Derive host URL + tenant DB name ────────────────────────────
    // Hybrid Tenancy: Standard tenants (including local dev) route to a shared
    // shard database. This allows a single Debezium container to monitor all
    // standard tenant schemas via one publication + replication slot.
    let sanitizedHostUrl: string;
    let connectionUrl: string;
    const tenantDbName = 'platform_shard_1';
    try {
      const parsedUrl = new URL(
        process.env.DATABASE_URL ||
          'postgresql://user:password@localhost:5432/platform_global',
      );
      // Sanitized host URL without credentials for registry persistence
      sanitizedHostUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.port ? ':' + parsedUrl.port : ''}`;
      // Connection URL with credentials for live DB connections
      const auth = parsedUrl.username
        ? `${parsedUrl.username}${parsedUrl.password ? ':' + parsedUrl.password : ''}@`
        : '';
      connectionUrl = `${parsedUrl.protocol}//${auth}${parsedUrl.hostname}${parsedUrl.port ? ':' + parsedUrl.port : ''}`;
    } catch (err) {
      const redactedUrl = process.env.DATABASE_URL
        ? process.env.DATABASE_URL.replace(/:\/\/[^@]*@/, '://***:***@')
        : '(not set)';
      console.warn(
        `⚠️  Failed to parse DATABASE_URL: ${redactedUrl}. Error: ${err instanceof Error ? err.message : String(err)}. Falling back to default.`,
      );
      sanitizedHostUrl = 'postgresql://localhost:5432';
      connectionUrl = 'postgresql://localhost:5432';
    }

    // ── Step 2: CREATE DATABASE platform_shard_1 + run tenant migrations ─
    console.log(`\n📦 Provisioning tenant database: ${tenantDbName}`);
    await this.tenantSchema.createTenantDatabase(tenantDbName, connectionUrl);

    // ── Step 3: Connect to global DB to register the tenant ─────────────────
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { Pool } = await import('pg');
    const dbSchema = await import('@soopa/database');
    const globalClient = await this.connectionPool.getPgClient();
    try {
      const globalDb = drizzle(globalClient, { schema: dbSchema });

      // Register in global tenant_storage_registry
      const existReg = await globalDb
        .select()
        .from(dbSchema.tenantStorageRegistry)
        .where(eq(dbSchema.tenantStorageRegistry.tenantId, devTenantId))
        .limit(1);

      if (!existReg[0]) {
        // First, create the mock Customer Organization
        await globalDb
          .insert(dbSchema.organization)
          .values({
            id: devTenantId,
            name: 'Edlewis Trucking (Local Dev)',
            slug: 'edlewis-trucking-dev',
            isSystem: false,
          })
          .onConflictDoNothing();
        console.log(
          `  ✓ Created mock customer org: Edlewis Trucking (${devTenantId})`,
        );

        await globalDb.insert(dbSchema.tenantStorageRegistry).values({
          tenantId: devTenantId,
          databaseName: tenantDbName,
          databaseHostUrl: sanitizedHostUrl,
          regionContext: 'local',
        });
        console.log(
          `  ✓ Registered ${tenantDbName} in tenant_storage_registry`,
        );
      } else {
        // Update host URL in case credentials changed
        await globalDb
          .update(dbSchema.tenantStorageRegistry)
          .set({ databaseName: tenantDbName, databaseHostUrl: sanitizedHostUrl })
          .where(eq(dbSchema.tenantStorageRegistry.tenantId, devTenantId));
        console.log(`  ✓ Updated tenant_storage_registry for ${tenantDbName}`);
      }

      // Query the actual number of tenants currently assigned to this shard
      const [{ count }] = await globalDb
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(dbSchema.tenantStorageRegistry)
        .where(eq(dbSchema.tenantStorageRegistry.databaseName, tenantDbName));

      // Always upsert shard_registry — runs whether org was created or already existed
      // Note: Do NOT reset currentTenants on conflict to preserve accurate capacity tracking
      await globalDb
        .insert(dbSchema.shardRegistry)
        .values({
          id: 'shard_1',
          databaseName: tenantDbName,
          databaseHostUrl: sanitizedHostUrl,
          regionContext: 'local',
          maxTenants: 1000,
          currentTenants: count,
          status: 'ACTIVE',
        })
        .onConflictDoUpdate({
          target: [dbSchema.shardRegistry.id],
          set: {
            databaseName: tenantDbName,
            databaseHostUrl: sanitizedHostUrl,
            status: 'ACTIVE',
            currentTenants: count,
          },
        });
      console.log(
        `  ✓ Upserted shard_registry: shard_1 → ${tenantDbName} (tenants: ${count})`,
      );

      // ── Drop stale ws_* schemas from platform_shard_1 ────────────────────────
      // REMOVED: provision should not drop anything. db:reset handles cleanup.

      // ── Step 4: Connect to tenant DB and write app_connection fixtures ───────
      // connectionUrl includes credentials for live DB connections
      const tenantUrl = `${connectionUrl.replace(/\/$/, '')}/${tenantDbName}`;
      let tenantPool: Pool | undefined;

      try {
        tenantPool = new Pool({ connectionString: tenantUrl, max: 5 });
        const tenantDb = drizzle(tenantPool, { schema: dbSchema });

        const { SchemaPlan } = await import('@soopa/dbmanager');
        const { TenantDatabaseManager } = await import('@soopa/dbmanager');
        const { getDomainProvisioner } = await import('@soopa/piece-framework');

        const schemaMgr = new TenantDatabaseManager(
          globalDb as unknown as import('@soopa/database').DrizzleDb,
          (_hostIdentifier: string) => {
            // Use cached pool to prevent connection leaks
            const cacheKey = tenantUrl;
            const cached = tenantPoolCache.get(cacheKey);
            if (cached) {
              return cached.drizzle;
            }
            const pool2 = new Pool({ connectionString: tenantUrl, max: 20 });
            const drizzleInstance = drizzle(pool2, {
              schema: dbSchema,
            }) as unknown as import('@soopa/database').DrizzleDb;
            const newCached = { pool: pool2, drizzle: drizzleInstance };
            tenantPoolCache.set(cacheKey, newCached);
            return newCached.drizzle;
          },
          getDomainProvisioner,
        );

        interface Fixture {
          id: string;
          appName: string;
          externalId: string;
          displayName: string;
          metadata: Record<string, unknown>;
          credentials: Record<string, unknown>;
        }
        const fixtures: Fixture[] = [
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
        ];

        const { getWorkspaceSchemaName } = await import('@soopa/dbmanager');

        for (const fixture of fixtures) {
          const encryptedValue = this.encryptFixture(
            JSON.stringify(fixture.credentials),
            encryptionKey,
          );

          // Write app_connection into the GLOBAL DB
          const [inserted] = await globalDb
            .insert(dbSchema.dataSources)
            .values({
              id: fixture.id,
              tenantId: devTenantId,
              appName: fixture.appName,
              externalId: fixture.externalId,
              displayName: fixture.displayName,
              metadata: fixture.metadata,
            })
            .onConflictDoUpdate({
              target: [
                dbSchema.dataSources.tenantId,
                dbSchema.dataSources.externalId,
              ],
              set: {
                displayName: fixture.displayName,
                metadata: fixture.metadata,
              },
            })
            .returning();

          if (!inserted) {
            throw new Error(
              `Upsert returned no row for externalId=${fixture.externalId}`,
            );
          }

          // Set expiresAt to 1 year from now so TokenManagerService/ConnectorsService treat this as live
          const futureExpiresAt = new Date();
          futureExpiresAt.setFullYear(futureExpiresAt.getFullYear() + 1);

          await globalDb
            .insert(dbSchema.credentials)
            .values({
              dataSourceId: inserted.id,
              authType: 'OAUTH2',
              value: encryptedValue,
              status: 'INACTIVE',
              expiresAt: futureExpiresAt,
            })
            .onConflictDoUpdate({
              target: [dbSchema.credentials.dataSourceId],
              set: {
                value: encryptedValue,
                authType: 'OAUTH2',
                expiresAt: futureExpiresAt,
                // Preserve ACTIVE/REVOKED status during update to avoid downgrading live connections.
                // This ensures fixture updates don't accidentally revoke production credentials.
                status: sql`CASE
                WHEN ${dbSchema.credentials.status} IN ('ACTIVE', 'REVOKED')
                THEN ${dbSchema.credentials.status}
                ELSE 'INACTIVE'
              END`,
              },
            });

          const schemaName = getWorkspaceSchemaName(
            inserted.id,
            inserted.appName,
          );

          // Provision workspace pipeline schemas inside the tenant DB
          await schemaMgr.applyPlan(
            devTenantId,
            schemaName,
            SchemaPlan.OUTBOUND_ACTIVE,
            {
              appName: inserted.appName,
              appProfile:
                (inserted.metadata as Record<string, string>)?.appProfile ||
                'standard',
            },
          );

          // Activate credential globally
          await globalDb
            .update(dbSchema.credentials)
            .set({ status: 'ACTIVE' })
            .where(eq(dbSchema.credentials.dataSourceId, inserted.id));

          // Mark connection ACTIVE in the tenant DB (upserting replica)
          await tenantDb
            .insert(dbSchema.dataSources)
            .values({
              id: inserted.id,
              tenantId: inserted.tenantId,
              appName: inserted.appName,
              externalId: inserted.externalId,
              displayName: inserted.displayName,
              metadata: inserted.metadata,
              schemaPlan: SchemaPlan.OUTBOUND_ACTIVE,
            })
            .onConflictDoUpdate({
              target: [dbSchema.dataSources.id],
              set: {
                appName: inserted.appName,
                externalId: inserted.externalId,
                displayName: inserted.displayName,
                metadata: inserted.metadata,
                schemaPlan: SchemaPlan.OUTBOUND_ACTIVE,
              },
            });

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
      }
    } finally {
      await globalClient.end();
    }
  }
}
