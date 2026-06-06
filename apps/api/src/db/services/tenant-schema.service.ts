/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Injectable } from '@nestjs/common';
import { EnvironmentGuardService } from './environment-guard.service.js';
import { PgConnectionPool } from '../infrastructure/pg-connection.pool.js';
import { MigrationRunnerService } from '../infrastructure/migration-runner.service.js';

@Injectable()
export class TenantSchemaService {
  constructor(
    private readonly environmentGuard: EnvironmentGuardService,
    private readonly connectionPool: PgConnectionPool,
    private readonly migrationRunner: MigrationRunnerService,
  ) {}

  async dropAll(): Promise<void> {
    this.environmentGuard.assertSafeEnvironment();
    console.log('🗑️  Dropping all schemas...');

    const client = await this.connectionPool.getPgClient();

    try {
      await this.connectionPool.execSql(
        'DROP SCHEMA IF EXISTS drizzle CASCADE;',
        client,
      );
      console.log('  ✓ Dropped drizzle schema');

      await this.connectionPool.execSql(
        'DROP SCHEMA IF EXISTS public CASCADE;',
        client,
      );
      console.log('  ✓ Dropped public schema');

      await this.connectionPool.execSql('CREATE SCHEMA public;', client);
      await this.connectionPool.execSql(
        'GRANT ALL ON SCHEMA public TO PUBLIC;',
        client,
      );
      console.log('  ✓ Recreated public schema');
    } catch (error) {
      throw new Error(
        `Failed to drop schemas: ${error instanceof Error ? error.message : error}`,
        { cause: error },
      );
    } finally {
      await client.end();
    }

    const { PgClient } = await this.connectionPool.resolvePgModule();
    const adminClient = new PgClient({
      connectionString: process.env.DATABASE_URL,
    });
    await adminClient.connect();
    try {
      const result = await adminClient.query<{ datname: string }>(
        `SELECT datname FROM pg_database WHERE datname LIKE 'nexiom_tenant_%' OR datname LIKE 'platform_shard_%' OR datname LIKE 'tenant_%'`,
      );
      for (const row of result.rows) {
        await this.dropTenantDatabaseIfExists(row.datname);
      }
    } finally {
      await adminClient.end();
    }
  }

  async dropTenantDatabaseIfExists(dbName: string): Promise<void> {
    const { PgClient } = await this.connectionPool.resolvePgModule();
    // @ts-expect-error - pg-format types are not fully compatible with NodeNext
    const format = (await import('pg-format')).default;
    const adminClient = new PgClient({
      connectionString: process.env.DATABASE_URL,
    });
    await adminClient.connect();
    try {
      await adminClient.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      // Use pg-format to properly escape the database identifier
      await adminClient.query(format('DROP DATABASE IF EXISTS %I', dbName));
      console.log(`  ✓ Dropped tenant database: ${dbName}`);
    } finally {
      await adminClient.end();
    }
  }

  async createTenantDatabase(dbName: string, hostUrl: string): Promise<void> {
    const { PgClient } = await this.connectionPool.resolvePgModule();
    const adminConnectionString = `${hostUrl.replace(/\/$/, '')}/postgres`;
    const adminClient = new PgClient({
      connectionString: adminConnectionString,
    });
    await adminClient.connect();

    try {
      const existing = await adminClient.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [dbName],
      );
      if (existing.rowCount === 0) {
        if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
          throw new Error(`Invalid tenant database name: ${dbName}`);
        }
        // @ts-expect-error - pg-format types are not fully compatible with NodeNext
        const format = (await import('pg-format')).default;
        await adminClient.query(format('CREATE DATABASE %I', dbName));
        console.log(`  ✓ Created tenant database: ${dbName}`);
      } else {
        console.log(`  ℹ️  Tenant database already exists: ${dbName}`);
      }
    } finally {
      await adminClient.end();
    }

    await this.migrationRunner.migrateTenant(dbName, hostUrl);
  }

  async truncateAll(): Promise<void> {
    this.environmentGuard.assertSafeEnvironment();
    console.log('🧹 Truncating all tables...');

    const client = await this.connectionPool.getPgClient();

    try {
      const tables = await this.connectionPool.querySql<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`,
        client,
      );

      if (tables.length === 0) {
        console.log(
          '  ℹ️  No tables found in public schema to truncate in global db',
        );
      } else {
        const quotedTables = tables
          .map((t) => `"${t.table_name.replaceAll('"', '""')}"`)
          .join(', ');
        const sql = `TRUNCATE TABLE ${quotedTables} CASCADE;`;
        await this.connectionPool.execSql(sql, client);
        console.log(`  ✓ Truncated ${tables.length} tables in global db`);
      }
    } catch (error) {
      console.log(`  ⚠️  Global Truncate failed: ${String(error)}`);
      throw error;
    } finally {
      await client.end();
    }

    const globalUrl = process.env.DATABASE_URL || '';
    if (globalUrl) {
      let shardUrl: string;
      try {
        const parsedGlobal = new URL(globalUrl);
        const globalDbName = parsedGlobal.pathname.replace(/^\/+/, '');
        if (!globalDbName || globalDbName !== 'platform_global') {
          console.log(
            `  ℹ️  Skipping shard truncation. Expecting DATABASE_URL to end with /platform_global but got /${globalDbName}`,
          );
          return;
        }
        parsedGlobal.pathname = '/platform_shard_1';
        shardUrl = parsedGlobal.toString();
      } catch (err) {
        console.log(`  ⚠️  Failed to construct shard URL: ${String(err)}`);
        return;
      }

      const { PgClient } = await this.connectionPool.resolvePgModule();
      let shardClient: typeof PgClient.prototype | null = null;
      try {
        shardClient = new PgClient({ connectionString: shardUrl });
        await shardClient.connect();
        const tables = await shardClient.query(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`,
        );

        if (tables.rowCount === 0) {
          console.log(
            '  ℹ️  No tables found in public schema to truncate in platform_shard_1',
          );
        } else {
          const quotedTables = tables.rows
            .map(
              (t: { table_name: string }) =>
                `"${t.table_name.replaceAll('"', '""')}"`,
            )
            .join(', ');
          await shardClient.query(`TRUNCATE TABLE ${quotedTables} CASCADE;`);
          console.log(
            `  ✓ Truncated ${tables.rowCount} tables in platform_shard_1`,
          );
        }
      } catch (err) {
        // Only ignore "database does not exist" errors (code '3D000')
        const pgCode =
          (err as { code?: string })?.code ||
          (err as { cause?: { code?: string } })?.cause?.code;
        if (pgCode === '3D000') {
          console.log(
            `  ℹ️  Shard database does not exist yet, skipping truncate`,
          );
        } else {
          console.log(`  ⚠️  Shard Truncate failed: ${String(err)}`);
          throw err;
        }
      } finally {
        if (shardClient) {
          await shardClient.end();
        }
      }
    }
  }
}
