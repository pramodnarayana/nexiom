import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let pgContainer: any;
let redisContainer: any;

export async function setup() {
  console.log('Starting Testcontainers for Integration Tests...');
  
  // Start Redis
  redisContainer = await new RedisContainer('redis:7-alpine').start();
  const redisUrl = redisContainer.getConnectionUrl();

  // Start Postgres
  pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('platform_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();
    
  const dbUrl = pgContainer.getConnectionUri();

  // Write URLs so tests can read them
  fs.writeFileSync(
    path.join(__dirname, '.test-env.json'),
    JSON.stringify({ DATABASE_URL: dbUrl, REDIS_URL: redisUrl, TEST_DATABASE_URL: dbUrl })
  );

  console.log('Testcontainers started. Running migrations...');
  
  process.env.DATABASE_URL = dbUrl;
  process.env.TEST_DATABASE_URL = dbUrl;
  
  const pool = new pg.Pool({ connectionString: dbUrl });
  const db = drizzle(pool);
  
  const migrationsFolderGlobal = join(__dirname, "..", "..", "..", "packages", "database", "drizzle", "global");
  const migrationsFolderTenant = join(__dirname, "..", "..", "..", "packages", "database", "drizzle", "tenant");

  await migrate(db, { migrationsFolder: migrationsFolderGlobal });
  
  // ── START ENTERPRISE GRADE FIX ──
  // Since global_entity_map is technically a tenant table (defined in drizzle/tenant)
  // but tests query it alongside global tables in public without a tenant prefix,
  // we manually provision it here instead of running migrate({ migrationsFolderTenant }).
  // Running the entire tenant migration suite on public conflicts with the global suite.
  await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "global_entity_map" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "stitch_id" uuid NOT NULL,
          "source_app_name" varchar(100) DEFAULT 'unknown' NOT NULL,
          "source_data_source_id" uuid NOT NULL,
          "source_org_id" varchar(255) DEFAULT 'unknown' NOT NULL,
          "source_org_name" varchar(255) DEFAULT 'unknown',
          "source_entity_type" varchar(100) DEFAULT 'unknown' NOT NULL,
          "source_entity_id" varchar(255) NOT NULL,
          "source_ref_layer" varchar(10) DEFAULT 'unspec' NOT NULL,
          "source_trace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
          "dest_app_name" varchar(100) DEFAULT 'unknown' NOT NULL,
          "dest_data_source_id" uuid NOT NULL,
          "dest_org_id" varchar(255) DEFAULT 'unknown' NOT NULL,
          "dest_org_name" varchar(255) DEFAULT 'unknown',
          "dest_entity_type" varchar(100) DEFAULT 'unknown' NOT NULL,
          "dest_entity_id" varchar(255) NOT NULL,
          "dest_ref_layer" varchar(10) DEFAULT 'unspec' NOT NULL,
          "dest_trace_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
          "last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );
  `);
  await db.execute(sql`
      DO $$ BEGIN
          ALTER TABLE "global_entity_map" ADD CONSTRAINT "gem_unique_mapping_idx" UNIQUE (
              "stitch_id",
              "source_data_source_id",
              "source_entity_id",
              "dest_data_source_id",
              "dest_entity_type"
          );
      EXCEPTION WHEN duplicate_table THEN NULL;
                WHEN duplicate_object THEN NULL;
      END $$;
  `);
  // ── END ENTERPRISE GRADE FIX ──
  
  await pool.end();

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
