import { Client } from 'pg';

const main = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined');
  }
  const connectionString = process.env.DATABASE_URL;
  const client = new Client({ connectionString });

  await client.connect();

  console.log('Truncating tables...');

  // Better Auth tables
  const tables = [
    'user',
    'session',
    'account',
    'verification',
    'organization',
    'member',
  ];

  for (const table of tables) {
    try {
      await client.query(`TRUNCATE TABLE "${table}" CASCADE;`);
    } catch (_e) {
      console.log(`Skipped ${table} (maybe doesn't exist)`);
    }
  }

  console.log('Done.');
  await client.end();
};

main().catch(console.error);
