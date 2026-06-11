import fs from 'fs';
import path from 'path';

export function setup() {
  console.log('--- TEST ENV SETUP SCRIPT CALLED ---');
  try {
    const envData = fs.readFileSync(path.join(__dirname, '.test-env.json'), 'utf8');
    const parsed = JSON.parse(envData);
    process.env.DATABASE_URL = parsed.DATABASE_URL;
    process.env.TEST_DATABASE_URL = parsed.TEST_DATABASE_URL || parsed.DATABASE_URL;
    process.env.REDIS_URL = parsed.REDIS_URL;
  } catch (err) {
    console.warn('Could not load .test-env.json - this is normal if not running integration tests');
  }
}

// Automatically invoke setup so env vars are populated in Vitest workers
setup();
