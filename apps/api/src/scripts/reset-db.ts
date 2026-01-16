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

const nodeEnv = process.env.NODE_ENV;
if (nodeEnv === 'production') {
  console.error('❌ Cannot reset database in production environment!');
  process.exit(1);
}

// Optional: require explicit confirmation via CLI arg
if (!process.argv.includes('--confirm')) {
  console.error(
    '⚠️  This will delete all data. Run with --confirm to proceed.',
  );
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
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void resetDb();
