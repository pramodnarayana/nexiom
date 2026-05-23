const { Pool } = require('pg');
const { execSync } = require('child_process');

async function migrateAll() {
  const basePgUrl = process.env.DATABASE_URL || process.env.BASE_PG_URL;
  if (!basePgUrl) {
    console.error('Error: DATABASE_URL or BASE_PG_URL environment variable must be set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: basePgUrl });
  try {
    const res = await pool.query('SELECT tenant_id, database_name FROM tenant_storage_registry');
    for (const row of res.rows) {
      // Derive tenant DB URL by replacing database name in base URL
      const baseUrl = new URL(basePgUrl);
      baseUrl.pathname = `/${row.database_name}`;
      const url = baseUrl.toString();

      console.log(`Migrating ${row.tenant_id} (${row.database_name})...`);
      execSync('pnpm --filter @nexiom/database db:migrate:tenant', {
        env: { ...process.env, TENANT_DATABASE_URL: url },
        stdio: 'inherit'
      });
    }
    console.log('All tenants migrated successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
migrateAll();
