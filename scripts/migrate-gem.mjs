import pg from 'pg';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../apps/api/.env'), override: false });
config({ path: resolve(__dirname, '../.env'), override: false });

const GLOBAL_DATABASE_URL = process.env.DATABASE_URL;
let TENANT_DATABASE_URL = process.env.TENANT_DATABASE_URL;

if (!GLOBAL_DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}



if (!TENANT_DATABASE_URL) {
  console.error('Could not determine TENANT_DATABASE_URL');
  process.exit(1);
}

const client = new pg.Client({ connectionString: TENANT_DATABASE_URL });
await client.connect();
console.log(`Connected to: ${TENANT_DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`);

try {
  // Find all schemas matching ws_%
  const { rows: schemas } = await client.query(`
    SELECT nspname AS schema_name
    FROM pg_namespace
    WHERE nspname LIKE 'ws_%'
  `);

  console.log(`Found ${schemas.length} workspace schemas.`);

  let totalMigrated = 0;

  for (const { schema_name } of schemas) {
    console.log(`Migrating GEM records from ${schema_name}...`);

    try {
      // Check if global_entity_map exists in this schema
      const { rows: tableCheck } = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = 'global_entity_map'
        ) as exists
      `, [schema_name]);

      if (!tableCheck[0].exists) {
        console.log(`  → No global_entity_map table found in ${schema_name}. Skipping.`);
        continue;
      }

      // Copy records to public.global_entity_map
      const result = await client.query(`
        INSERT INTO public.global_entity_map (
          id, stitch_id, source_app_name, source_app_id, source_org_id, source_org_name, 
          source_entity_type, source_entity_id, source_ref_layer, source_trace_id, 
          dest_app_name, dest_app_id, dest_org_id, dest_org_name, dest_entity_type, 
          dest_entity_id, dest_ref_layer, dest_trace_id, last_synced_at, created_at
        )
        SELECT 
          id, stitch_id, source_app_name, source_app_id, source_org_id, source_org_name, 
          source_entity_type, source_entity_id, source_ref_layer, source_trace_id, 
          dest_app_name, dest_app_id, dest_org_id, dest_org_name, dest_entity_type, 
          dest_entity_id, dest_ref_layer, dest_trace_id, last_synced_at, created_at
        FROM "${schema_name}".global_entity_map
        ON CONFLICT DO NOTHING
      `);

      console.log(`  → Copied ${result.rowCount} records from ${schema_name}.`);
      totalMigrated += result.rowCount;
    } catch (err) {
      console.error(`  → Error migrating ${schema_name}:`, err.message);
    }
  }

  console.log(`\nMigration complete. Total records migrated: ${totalMigrated}`);
} catch (err) {
  console.error('Fatal error:', err);
} finally {
  await client.end();
}
