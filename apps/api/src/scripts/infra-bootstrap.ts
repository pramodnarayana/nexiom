import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Environment Variables (MUST BE FIRST)
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from '@soopa/database';

async function seedLocalShard() {
  console.log('🚀 Starting Infrastructure Bootstrap...');
  console.log('1️⃣  Seeding local shard_registry...');

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL not found!');
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const db = drizzle(client, { schema });

  try {
    const parsedUrl = new URL(dbUrl);
    // Remove credentials from stored URL - must be provided at runtime from secrets manager
    const hostUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;

    const shardId = process.env.SHARD_ID || 'shard-local-1';
    const databaseName = process.env.DB_NAME || 'platform_shard_1';

    await db
      .insert(schema.shardRegistry)
      .values({
        id: shardId,
        databaseName,
        databaseHostUrl: hostUrl,
        regionContext: 'local',
        status: 'ACTIVE',
        maxTenants: 100,
        currentTenants: 0,
      })
      .onConflictDoNothing();

    console.log(`✅ Local shard ${shardId} registered.`);

    console.log('2️⃣  Running tenant migrations on local shard...');
    try {
      // Build connection string with credentials for migration (runtime only, not stored)
      const migrationUrl = `${parsedUrl.protocol}//${parsedUrl.username}:${parsedUrl.password}@${parsedUrl.host}/${databaseName}`;
      execSync(`pnpm --filter @soopa/database db:migrate:tenant`, {
        env: {
          ...process.env,
          TENANT_DATABASE_URL: migrationUrl,
        },
        stdio: 'inherit',
      });
      console.log('✅ Shard migrations complete.');
    } catch (migrationError) {
      const errMsg = migrationError instanceof Error ? migrationError.message : String(migrationError);
      const errStack = migrationError instanceof Error ? migrationError.stack : '';
      console.error(`❌ Migration failed for shard ${shardId}:`);
      console.error(`  Command: pnpm --filter @soopa/database db:migrate:tenant`);
      console.error(`  Database: ${hostUrl}/${databaseName}`);
      console.error(`  Error: ${errMsg}`);
      if (errStack) console.error(`  Stack: ${errStack}`);
      throw migrationError;
    }

    console.log('✅ Infrastructure Bootstrap complete.');
  } finally {
    await client.end();
  }
}

seedLocalShard().catch((err) => {
  console.error(err);
  process.exit(1);
});
