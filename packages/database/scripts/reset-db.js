import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function resetDb() {
  console.log('Resetting database...');
  try {
    // Find all tenant schemas
    const schemas = await pool.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'ws_%'");
    for (const s of schemas.rows) {
      console.log(`Dropping schema ${s.schema_name}...`);
      await pool.query(`DROP SCHEMA IF EXISTS "${s.schema_name}" CASCADE`);
    }

    console.log('Dropping public schema...');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    
    console.log('Recreating public schema...');
    await pool.query('CREATE SCHEMA public');

    console.log('Database reset successfully.');
  } catch (err) {
    console.error('Error resetting DB:', err);
    process.exit(1);
  } finally {
    pool.end();
  }
}

resetDb();
