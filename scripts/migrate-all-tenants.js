const { Pool } = require('pg');
const { execSync } = require('child_process');

async function migrateAll() {
  const pool = new Pool({ connectionString: 'postgres://user:password@localhost:5432/nexiom_global' });
  try {
    const res = await pool.query('SELECT tenant_id, database_name FROM tenant_storage_registry');
    for (const row of res.rows) {
      const url = `postgres://user:password@localhost:5432/${row.database_name}`;
      console.log(`Migrating ${row.tenant_id} (${row.database_name})...`);
      execSync('pnpm --filter @nexiom/database db:migrate:tenant', {
        env: { ...process.env, TENANT_DATABASE_URL: url },
        stdio: 'inherit'
      });
    }
    console.log('All tenants migrated successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await pool.end();
  }
}
migrateAll();
