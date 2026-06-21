import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { MigrationRunnerPort, RunMigrationsOptions } from '../ports/migration-runner.port.js';

@Injectable()
export class DrizzleMigrationRunnerAdapter implements MigrationRunnerPort {
  private readonly logger = new Logger(DrizzleMigrationRunnerAdapter.name);

  async runMigrations(db: unknown, options: RunMigrationsOptions): Promise<void> {
    const { migrationsFolder } = options;

    // Obtain a single client for the entire migration to preserve session state
    let client: unknown;
    let shouldReleaseClient = false;
    const d = db as Record<string, unknown>;

    if (typeof d.connect === 'function') {
      // It's a pg.Pool - get a dedicated client
      client = await (d.connect as () => Promise<unknown>)();
      shouldReleaseClient = true;
    } else {
      // It's already a Drizzle db or pg.Client - use it directly
      client = db;
    }

    const runQuery = async (query: string, runner: unknown = client): Promise<any> => {
      const r = runner as Record<string, unknown>;
      if (typeof r.query === 'function') {
        return (r.query as (q: string) => Promise<any>)(query); // pg Pool/Client
      } else if (typeof r.execute === 'function') {
        // Drizzle db instance
        const { sql } = await import('drizzle-orm');
        return (r.execute as (q: unknown) => Promise<any>)(sql.raw(query));
      } else {
        throw new Error('Unsupported database client provided to migrator.');
      }
    };

    const runTransaction = async (query: string) => {
      const r = client as Record<string, unknown>;
      if (typeof r.transaction === 'function') {
        return (r.transaction as (cb: (tx: unknown) => Promise<void>) => Promise<void>)(async (tx: unknown) => {
          await runQuery(query, tx);
        });
      } else {
        // Fallback for pg Pool/Client
        await runQuery('BEGIN;', client);
        try {
          await runQuery(query, client);
          await runQuery('COMMIT;', client);
        } catch (e) {
          await runQuery('ROLLBACK;', client);
          throw e;
        }
      }
    };

    let schemaLockId: number | undefined;

    try {
      // Get current schema to generate a unique lock ID per tenant
      const schemaRes = await runQuery(`SELECT current_schema();`, client);
      const schemaRows = schemaRes.rows || schemaRes;
      const schemaName = schemaRows[0]?.current_schema || 'public';

      // Generate a 32-bit integer lock ID from the schema name
      schemaLockId = crypto.createHash('md5').update(schemaName).digest().readInt32BE(0);

      this.logger.log(`Acquiring migration lock for schema ${schemaName} (ID: ${schemaLockId})...`);
      // Acquire session-level advisory lock
      await runQuery(`SELECT pg_advisory_lock(${schemaLockId});`, client);

      // 1. Ensure migrations table exists
      await runQuery(`
        CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        );
      `, client);

      // 2. Read journal.json
      const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
      let journalStr = '';
      try {
        journalStr = await fs.readFile(journalPath, 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          this.logger.warn(`No _journal.json found at ${journalPath}, skipping migrations.`);
          return;
        }
        throw e;
      }

      const journal = JSON.parse(journalStr);
      if (!journal.entries || journal.entries.length === 0) {
        return;
      }

      // 3. Fetch applied migrations
      const appliedRes = await runQuery(`SELECT id, hash, created_at FROM "__drizzle_migrations" ORDER BY created_at ASC;`, client);
      // handle difference between pg and drizzle return structures
      const appliedRows = appliedRes.rows || appliedRes;
      const appliedHashes = new Set(appliedRows.map((r: Record<string, unknown>) => r.hash as string));

      for (const entry of journal.entries) {
        const migrationFileName = `${entry.tag}.sql`;
        const migrationPath = path.join(migrationsFolder, migrationFileName);
        const content = await fs.readFile(migrationPath, 'utf8');

        // Drizzle kit uses SHA-256 of the file content for hash
        const hash = crypto.createHash('sha256').update(content).digest('hex');

        if (appliedHashes.has(hash)) {
          // Already applied
          continue;
        }

        this.logger.log(`Applying migration: ${migrationFileName}`);

        const disableTransaction = content.includes('--disable-ddl-transaction');
        const ts = Date.now();

        if (disableTransaction) {
          this.logger.log(`Executing ${migrationFileName} OUTSIDE transaction (disable-ddl-transaction detected)`);
          await runQuery(content, client);
          // Record it outside transaction
          await runQuery(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ('${hash}', ${ts});`, client);
        } else {
          this.logger.log(`Executing ${migrationFileName} inside transaction`);
          // Execute migration and record hash atomically
          const r = client as Record<string, unknown>;
          if (typeof r.transaction === 'function') {
            await (r.transaction as (cb: (tx: unknown) => Promise<void>) => Promise<void>)(async (tx: unknown) => {
              await runQuery(content, tx);
              await runQuery(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ('${hash}', ${ts});`, tx);
            });
          } else {
            // Fallback for pg Pool/Client
            await runQuery('BEGIN;', client);
            try {
              await runQuery(content, client);
              await runQuery(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ('${hash}', ${ts});`, client);
              await runQuery('COMMIT;', client);
            } catch (e) {
              await runQuery('ROLLBACK;', client);
              throw e;
            }
          }
        }

        this.logger.log(`Successfully applied ${migrationFileName}`);
      }

    } finally {
      // Release lock
      try {
        if (typeof schemaLockId !== 'undefined') {
          await runQuery(`SELECT pg_advisory_unlock(${schemaLockId});`, client);
          this.logger.log(`Released migration lock for schema (ID: ${schemaLockId}).`);
        }
      } catch (e) {
        this.logger.error(`Failed to release migration lock: ${e}`);
      }

      // Release client if we acquired it
      if (shouldReleaseClient) {
        const c = client as Record<string, unknown>;
        if (typeof c.release === 'function') {
          (c.release as () => void)();
        }
      }
    }
  }
}
