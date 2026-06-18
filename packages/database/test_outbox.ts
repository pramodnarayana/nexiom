import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
import { sql, getTableName } from 'drizzle-orm';
import { buildTenantSchema } from '@soopa/database';

const { Pool } = pkg;

const pool = new Pool({
  connectionString: 'postgresql://user:password@localhost:5432/platform_shard_1',
});

const db = drizzle(pool, { logger: true });

async function run() {
  const schemaName = 'ws_quickbooks_1a4024034c52e493';
  const { inboundOutbox } = buildTenantSchema(schemaName);
  const table = inboundOutbox;
  const batchSize = 50;

  try {
    const res = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}`);
      return tx.update(table).set({
        status: 'PROCESSING',
        attempts: sql`${table.attempts} + 1`,
        nextRetryAt: sql`NOW() + INTERVAL '5 minutes'`,
        claimToken: 'test-token',
      }).where(
          sql`(${table.id}) IN (
            SELECT id FROM ${sql.identifier(schemaName)}.${sql.identifier(getTableName(table))}
            WHERE (status = 'PENDING' AND (next_retry_at IS NULL OR next_retry_at <= NOW()))
               OR (status = 'RETRY' AND next_retry_at <= NOW())
               OR (status = 'PROCESSING' AND next_retry_at <= NOW())
            ORDER BY next_retry_at ASC
            LIMIT ${batchSize}
            FOR UPDATE SKIP LOCKED
          )`
      ).returning();
    });
    console.log("Success:", res);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

run();
