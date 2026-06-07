import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

let pgContainer: any;
let redisContainer: any;

export async function setup() {
  console.log('Starting Testcontainers for Integration Tests...');
  
  // Start Redis
  redisContainer = await new RedisContainer('redis:7-alpine').start();
  const redisUrl = redisContainer.getConnectionUrl();

  // Start Postgres
  pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('nexiom_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();
    
  const dbUrl = pgContainer.getConnectionUri();

  // Write URLs so tests can read them
  fs.writeFileSync(
    path.join(__dirname, '.test-env.json'),
    JSON.stringify({ DATABASE_URL: dbUrl, REDIS_URL: redisUrl })
  );

  console.log('Testcontainers started. Running migrations...');
  
  process.env.DATABASE_URL = dbUrl;
  
  // Run Drizzle push to sync schema directly
  execSync('pnpm --filter @soopa/database exec drizzle-kit push --config drizzle.config.ts', { stdio: 'inherit' });
  console.log('Migrations complete. Ready for tests.');
}

export async function teardown() {
  console.log('Stopping Testcontainers...');
  if (redisContainer) await redisContainer.stop();
  if (pgContainer) await pgContainer.stop();
  
  try {
    fs.unlinkSync(path.join(__dirname, '.test-env.json'));
  } catch (err) {}
}
