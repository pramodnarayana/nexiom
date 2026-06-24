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

    // ── Client acquisition ────────────────────────────────────────────────────
    // We always acquire a *dedicated* pg.Client from the pool (never the shared
    // pool connection itself) so that session-level state changes (advisory lock,
    // search_path) are fully isolated to this migration run.
    let client: Record<string, unknown>;
    let shouldReleaseClient = false;
    const d = db as Record<string, unknown>;

    const pool = typeof d.connect === 'function'
      ? d
      : d.$client as Record<string, unknown> | undefined;

    if (pool && typeof pool.connect === 'function') {
      client = await (pool.connect as () => Promise<Record<string, unknown>>)();
      shouldReleaseClient = true;
    } else {
      // Already a raw pg.Client — use directly.
      client = d;
    }

    // ── Query helper ─────────────────────────────────────────────────────────
    const runQuery = async (query: string): Promise<any> => {
      if (typeof client.query === 'function') {
        return (client.query as (q: string) => Promise<any>)(query);
      }
      throw new Error('Migration runner: pg client does not expose a query() method.');
    };

    // ── Advisory lock ─────────────────────────────────────────────────────────
    // A session-level advisory lock serialises concurrent migrations for the same
    // schema across multiple worker processes / pods.  Different schemas get
    // different lock IDs so they never block each other.
    // The lock is automatically released when the client is returned to the pool
    // (or on disconnect), providing a safe fallback even if the unlock call below
    // is never reached.
    const schemaLockKey = options.searchPath ?? 'public';
    const schemaLockId = crypto
      .createHash('md5')
      .update(schemaLockKey)
      .digest()
      .readInt32BE(0);

    try {
      this.logger.log(
        `Acquiring migration lock for schema "${schemaLockKey}" (ID: ${schemaLockId})...`,
      );
      await runQuery(`SELECT pg_advisory_lock(${schemaLockId});`);

      // ── search_path ─────────────────────────────────────────────────────────
      // Set at session level on this *dedicated* client — correct because:
      //   1. The client is not shared with any other query during this method.
      //   2. All subsequent queries (CREATE TABLE, SELECT hash, migration SQL,
      //      INSERT hash) automatically resolve against the target schema without
      //      requiring per-statement schema qualification.
      // Before releasing the client we issue RESET search_path so the connection
      // returns to the pool in a clean state (see finally block below).
      if (options.searchPath) {
        this.logger.log(`Setting search_path to "${options.searchPath}"`);
        await runQuery(`SET search_path TO "${options.searchPath}";`);
      }

      // ── Migrations table ────────────────────────────────────────────────────
      // Created outside of any per-migration transaction so it survives a
      // rollback of a failed individual migration.
      await runQuery(`
        CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
          id         SERIAL PRIMARY KEY,
          hash       text   NOT NULL,
          created_at bigint
        );
      `);

      // ── Journal ──────────────────────────────────────────────────────────────
      const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
      let journalStr = '';
      try {
        journalStr = await fs.readFile(journalPath, 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          this.logger.warn(`No _journal.json at ${journalPath} — skipping.`);
          return;
        }
        throw e;
      }

      const journal = JSON.parse(journalStr) as { entries?: Array<{ tag: string }> };
      if (!journal.entries?.length) {
        return;
      }

      // ── Applied-hash set ─────────────────────────────────────────────────────
      const appliedRes = await runQuery(
        `SELECT hash FROM "__drizzle_migrations" ORDER BY created_at ASC;`,
      );
      const appliedRows: Array<{ hash: string }> = appliedRes.rows ?? appliedRes;
      const appliedHashes = new Set(appliedRows.map((r) => r.hash));

      // ── Apply pending migrations ─────────────────────────────────────────────
      for (const entry of journal.entries) {
        const fileName = `${entry.tag}.sql`;
        const filePath  = path.join(migrationsFolder, fileName);
        const content   = await fs.readFile(filePath, 'utf8');

        const hash = crypto.createHash('sha256').update(content).digest('hex');
        if (appliedHashes.has(hash)) {
          continue;
        }

        this.logger.log(`Applying migration: ${fileName}`);

        const disableTransaction = content.includes('--disable-ddl-transaction');
        const ts = Date.now();

        if (disableTransaction) {
          // Some DDL (e.g. CREATE INDEX CONCURRENTLY) cannot run inside a
          // transaction.  search_path is already set at session level so these
          // statements resolve against the correct schema automatically.
          this.logger.log(
            `Executing ${fileName} outside transaction (--disable-ddl-transaction)`,
          );
          await runQuery(content);
          // Record the hash atomically in its own transaction.
          await runQuery('BEGIN;');
          try {
            await runQuery(
              `INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ('${hash}', ${ts});`,
            );
            await runQuery('COMMIT;');
          } catch (e) {
            await runQuery('ROLLBACK;');
            throw e;
          }
        } else {
          // Standard path: wrap migration SQL + hash recording in a single atomic
          // transaction.  PostgreSQL supports transactional DDL, so a failure here
          // leaves the schema fully unchanged — no partial state.
          this.logger.log(`Executing ${fileName} inside transaction`);
          await runQuery('BEGIN;');
          try {
            await runQuery(content);
            await runQuery(
              `INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ('${hash}', ${ts});`,
            );
            await runQuery('COMMIT;');
          } catch (e) {
            await runQuery('ROLLBACK;');
            throw e;
          }
        }

        this.logger.log(`Successfully applied ${fileName}`);
      }

    } finally {
      // ── Release advisory lock ─────────────────────────────────────────────
      try {
        await runQuery(`SELECT pg_advisory_unlock(${schemaLockId});`);
        this.logger.log(
          `Released migration lock for schema "${schemaLockKey}" (ID: ${schemaLockId}).`,
        );
      } catch (e) {
        this.logger.error(`Failed to release migration lock: ${e}`);
      }

      // ── Return client to pool in a clean state ────────────────────────────
      // RESET search_path restores the server/role default — the semantically
      // correct reset, unlike hard-coding "public" which would break installations
      // where search_path is configured differently at the database or role level.
      if (shouldReleaseClient) {
        try {
          await runQuery('RESET search_path;');
        } catch {
          // Best-effort: if the connection is already broken the pool will
          // destroy it on release.
        }
        if (typeof client.release === 'function') {
          (client.release as () => void)();
        }
      }
    }
  }
}
