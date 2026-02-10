import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

// Load env from apps/api/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  let exitCode = 0;

  try {
    await client.connect();
    console.log('Renaming column...');

    // Rename 'image_url' to 'image' in 'user' table if it exists
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'user'
            AND table_schema = 'public'
            AND column_name = 'image_url'
        ) THEN
            ALTER TABLE "user" RENAME COLUMN "image_url" TO "image";
        END IF;
      END $$;
    `);

    console.log('Column rename operation completed successfully');
  } catch (e: unknown) {
    exitCode = 1;
    if (e instanceof Error) {
      console.error('Error renaming column:', e.message);
    } else {
      console.error('Error renaming column:', e);
    }
  } finally {
    try {
      await client.end();
    } catch (endError) {
      console.error('Error closing connection:', endError);
    }
  }

  process.exit(exitCode);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
