import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env from apps/api/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not found in environment');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();

  try {
    const email = 'pramod.narayana+tenant1_supportuser1@gmail.com';
    console.log(`Deleting user with email: ${email}`);
    // Delete from user table. Cascading should handle related records if configured,
    // but better-auth usually has CASCADE on foreign keys.
    const res = await client.query('DELETE FROM "user" WHERE email = $1', [
      email,
    ]);
    console.log(`Deleted ${res.rowCount} user(s).`);
  } catch (err) {
    console.error('Error deleting user:', err);
  } finally {
    await client.end();
  }
}

void main();
