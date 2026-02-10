import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

// Load env from apps/api/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DEFAULT_EMAIL = 'test-user@example.com';

async function main() {
  if (
    process.env.NODE_ENV === 'production' &&
    !process.argv.includes('--confirm')
  ) {
    console.error('Refusing to run in production without --confirm flag');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not found in environment');
    process.exit(1);
  }

  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const emailArg = args[0];
  const email = emailArg || DEFAULT_EMAIL;

  if (!emailArg) {
    console.warn(
      `No email argument provided. Defaulting to test user: ${DEFAULT_EMAIL}`,
    );
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log(`Deleting user with email: ${email}`);

    // Delete from user table. Cascading should handle related records if configured.
    const res = await client.query('DELETE FROM "user" WHERE email = $1', [
      email,
    ]);
    console.log(`Deleted ${res.rowCount} user(s).`);
  } catch (err) {
    console.error('Error deleting user:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
