import { Injectable } from '@nestjs/common';
import { EnvironmentGuardService } from './environment-guard.service.js';
import { PgConnectionPool } from '../infrastructure/pg-connection.pool.js';

@Injectable()
export class ConnectionSchemaProvisionerService {
  constructor(
    private readonly environmentGuard: EnvironmentGuardService,
    private readonly connectionPool: PgConnectionPool,
  ) {}

  /**
   * Helper to initialize SqlDatabaseManager with correct schema, db, and client.
   * Ensures client.end() in a finally block.
   */
  private async withSchemaMgr<T>(
    cb: (
      mgr: import('@soopa/dbmanager').TenantDatabaseManager,
      db: import('@soopa/database').DrizzleDb,
    ) => Promise<T>,
  ): Promise<T> {
    const { TenantDatabaseManager } = await import('@soopa/dbmanager');
    const { getDomainProvisioner } = await import('@soopa/piece-framework');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { Pool } = await import('pg');
    const dbSchema = await import('@soopa/database');
    const client = await this.connectionPool.getPgClient();

    // Track created pools to ensure they are closed
    const createdPools: typeof Pool.prototype[] = [];

    try {
      const db = drizzle(client, { schema: dbSchema });
      const { dbUrl } = await this.connectionPool.resolvePgModule();
      const schemaMgr = new TenantDatabaseManager(
        db as unknown as import('@soopa/database').DrizzleDb,
        (hostIdentifier: string) => {
          // Rehydrate credentials from DATABASE_URL
          const parsedEnv = new URL(dbUrl);
          const parsedHost = new URL(hostIdentifier);

          const fullDsn = `${parsedHost.protocol}//${parsedEnv.username}:${parsedEnv.password}@${parsedHost.host}${parsedHost.pathname}${parsedHost.search}`;

          const pool = new Pool({
            connectionString: fullDsn,
            max: 20,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
          });
          // Track the pool so we can close it in finally
          createdPools.push(pool);
          return drizzle(pool, {
            schema: dbSchema,
          }) as unknown as import('@soopa/database').DrizzleDb;
        },
        getDomainProvisioner,
      );
      return await cb(
        schemaMgr,
        db as unknown as import('@soopa/database').DrizzleDb,
      );
    } finally {
      // Close all created pools
      await Promise.all(createdPools.map((pool) => pool.end()));
      await client.end();
    }
  }

  /**
   * Upgrades a connection's physical schema to GATEWAY_ACTIVE,
   * creating the inbound_gateway (L1) table so webhook payloads can be ingested.
   */
  async provisionGateway(schemaName: string): Promise<void> {
    this.environmentGuard.assertSafeEnvironment();
    console.log(`\n🔧 Applying GATEWAY_ACTIVE to schema: ${schemaName}...`);

    const { SchemaPlan } = await import('@soopa/dbmanager');
    const dbSchema = await import('@soopa/database');
    const { eq } = await import('drizzle-orm');

    await this.withSchemaMgr(async (schemaMgr, db) => {
      const connRow = await db
        .select({ tenantId: dbSchema.dataSources.tenantId })
        .from(dbSchema.dataSources)
        .where(eq(dbSchema.dataSources.schemaName, schemaName))
        .limit(1);

      const tenantId = connRow[0]?.tenantId;
      if (!tenantId) {
        throw new Error(
          `No connection found with schema_name="${schemaName}".`,
        );
      }

      await schemaMgr.applyPlan(
        tenantId,
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
    this.environmentGuard.assertSafeEnvironment();
    console.log(`\n🔧 Applying OUTBOUND_ACTIVE to schema: ${schemaName}...`);

    const { SchemaPlan } = await import('@soopa/dbmanager');
    const dbSchema = await import('@soopa/database');
    const { eq } = await import('drizzle-orm');

    await this.withSchemaMgr(async (schemaMgr, db) => {
      const connRow = await db
        .select({ tenantId: dbSchema.dataSources.tenantId })
        .from(dbSchema.dataSources)
        .where(eq(dbSchema.dataSources.schemaName, schemaName))
        .limit(1);

      const tenantId = connRow[0]?.tenantId;
      if (!tenantId) {
        throw new Error(
          `No connection found with schema_name="${schemaName}".`,
        );
      }

      await schemaMgr.applyPlan(
        tenantId,
        schemaName,
        SchemaPlan.OUTBOUND_ACTIVE,
      );
      console.log(`  ✓ Schema "${schemaName}" upgraded to OUTBOUND_ACTIVE`);
    });
  }

  /**
   * Discovers all tenant schemas (ws_*) and migrates them to OUTBOUND_ACTIVE state.
   */
  async migrateAllSchemas(): Promise<void> {
    this.environmentGuard.assertSafeEnvironment();
    console.log(
      '\n🔧 Migrating all tenant schemas to OUTBOUND_ACTIVE state...',
    );

    const dbSchema = await import('@soopa/database');
    const { eq } = await import('drizzle-orm');

    await this.withSchemaMgr(async (schemaMgr, db) => {
      const client = await this.connectionPool.getPgClient();
      try {
        const result = await client.query<{ schema_name: string }>(`
          SELECT schema_name
          FROM information_schema.schemata
          WHERE schema_name LIKE 'ws\_%' ESCAPE '\'
          ORDER BY schema_name;
        `);

        if (result.rows.length === 0) {
          console.log('  ℹ️  No tenant schemas found.');
          return;
        }

        const failures: Array<{ schema: string; error: string }> = [];

        for (const { schema_name } of result.rows) {
          try {
            const connRow = await db
              .select({ tenantId: dbSchema.dataSources.tenantId })
              .from(dbSchema.dataSources)
              .where(eq(dbSchema.dataSources.schemaName, schema_name))
              .limit(1);

            const tenantId = connRow[0]?.tenantId;
            if (!tenantId) {
              throw new Error(
                `No connection found for schema "${schema_name}" — skipping migration.`,
              );
            }

            await schemaMgr.migrateToOutboundActive(tenantId, schema_name);
            console.log(`  ✓ ${schema_name}`);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`  ✗ ${schema_name}:`, errorMsg);
            failures.push({ schema: schema_name, error: errorMsg });
          }
        }

        if (failures.length > 0) {
          throw new Error(`Migration failed for ${failures.length} schema(s).`);
        }

        console.log(
          `\n✅ All ${result.rows.length} tenant schema(s) migrated successfully.`,
        );
      } finally {
        await client.end();
      }
    });
  }
}
