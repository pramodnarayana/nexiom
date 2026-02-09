import { Pool } from 'pg';

// script to rename column
const main = async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Renaming column...');
    await pool.query('ALTER TABLE "user" RENAME COLUMN "image_url" TO "image"');
    console.log('Column renamed successfully');
  } catch (e: unknown) {
    if (e instanceof Error) {
      console.error('Error renaming column:', e.message);
    } else {
      console.error('Error renaming column:', e);
    }
  } finally {
    await pool.end();
  }
};

void main();
