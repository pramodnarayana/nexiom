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

    // We assume `db` exposes an `execute(sql)` or `query(sql)` method. 
    // Drizzle's DB object has `execute()` which accepts `sql.raw()`.
    // Wait, let's detect the interface.
    const runQuery = async (query: string, runner: unknown = db): Promise<any> => {
      // If it's a Drizzle instance, it might need sql.raw
      // We will try raw query if it's pg.Pool, else fallback
      const r = runner as Record<string, unknown>;
      if (typeof r.query === 'function') {
        return (r.query as (q: string) => Promise<any>)(query); // pg Pool/Client
      } else if (typeof r.execute === 'function') {
        // Drizzle db instance
        // Hack to get raw sql in case it's drizzle
        const { sql } = await import('drizzle-orm');
        return (r.execute as (q: unknown) => Promise<any>)(sql.raw(query));
      } else {
        throw new Error('Unsupported database client provided to migrator.');
      }
    };

    const runTransaction = async (query: string) => {
      const d = db as Record<string, unknown>;
      if (typeof d.transaction === 'function') {
        return (d.transaction as (cb: (tx: unknown) => Promise<void>) => Promise<void>)(async (tx: unknown) => {
          await runQuery(query, tx);
        });
      } else {
        // Fallback for pg Pool
        await runQuery('BEGIN;');
        try {
          await runQuery(query);
          await runQuery('COMMIT;');
        } catch (e) {
          await runQuery('ROLLBACK;');
          throw e;
        }
      }
    };

    let schemaLockId: number | undefined;

    try {
      // Get current schema to generate a unique lock ID per tenant
      const schemaRes = await runQuery(`SELECT current_schema();`);
      const schemaRows = schemaRes.rows || schemaRes;
      const schemaName = schemaRows[0]?.current_schema || 'public';
      
      // Generate a 32-bit integer lock ID from the schema name
      schemaLockId = crypto.createHash('md5').update(schemaName).digest().readInt32BE(0);

      this.logger.log(`Acquiring migration lock for schema ${schemaName} (ID: ${schemaLockId})...`);
      // Acquire session-level advisory lock
      await runQuery(`SELECT pg_advisory_lock(${schemaLockId});`);

      // 1. Ensure migrations table exists
      await runQuery(`
        CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        );
      `);

      // 2. Read journal.json
      const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
      let journalStr = '';
      try {
        journalStr = await fs.readFile(journalPath, 'utf8');
      } catch (e) {
        this.logger.warn(`No _journal.json found at ${journalPath}, skipping migrations.`);
        return;
      }

      const journal = JSON.parse(journalStr);
      if (!journal.entries || journal.entries.length === 0) {
        return;
      }

      // 3. Fetch applied migrations
      const appliedRes = await runQuery(`SELECT id, hash, created_at FROM "__drizzle_migrations" ORDER BY created_at ASC;`);
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

        if (disableTransaction) {
          this.logger.log(`Executing ${migrationFileName} OUTSIDE transaction (disable-ddl-transaction detected)`);
          await runQuery(content);
        } else {
          this.logger.log(`Executing ${migrationFileName} inside transaction`);
          await runTransaction(content);
        }

        // Record it
        const ts = Date.now();
        await runQuery(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ('${hash}', ${ts});`);
        this.logger.log(`Successfully applied ${migrationFileName}`);
      }

    } finally {
      // Release lock
      try {
        if (typeof schemaLockId !== 'undefined') {
          await runQuery(`SELECT pg_advisory_unlock(${schemaLockId});`);
          this.logger.log(`Released migration lock for schema (ID: ${schemaLockId}).`);
        }
      } catch (e) {
        this.logger.error(`Failed to release migration lock: ${e}`);
      }
    }
  }
}
