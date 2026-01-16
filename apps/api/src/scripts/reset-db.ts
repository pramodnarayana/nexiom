import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load Environment Variables
// Current Dir: apps/api/src/scripts
// API Root: ../../
// Repo Root: ../../../../

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL not found!');
  process.exit(1);
}

const client = new Client({ connectionString: dbUrl });

async function resetDb() {
  await client.connect();

  try {
    console.log('⚠️  Resetting Database (Truncating Data)...');

    // Truncate in specific order to avoid FK constraints (or use CASCADE)
    await client.query(`
            TRUNCATE TABLE 
                "invitation",
                "member",
                "session",
                "account",
                "verification",
                "organization",
                "user"
            CASCADE;
        `);

    console.log('✅ Database Cleaned. Ready for Fresh Start.');
  } catch (err) {
    console.error('Error resetting DB:', err);
  } finally {
    await client.end();
  }
}

void resetDb();
