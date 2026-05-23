/**
 * apply-global-tables.mjs
 *
 * Applies only the MISSING tables from migration 0005 to the global DB.
 * Safe to run multiple times — all CREATE TABLE / TYPE statements use IF NOT EXISTS.
 */

import pg from 'pg';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../apps/api/.env'), override: false });
config({ path: resolve(__dirname, '../.env'), override: false });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

const statements = [
  // Enums (idempotent)
  `DO $$ BEGIN CREATE TYPE "public"."scheduler_outbox_action_enum" AS ENUM('created', 'updated', 'deleted'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN CREATE TYPE "public"."scheduler_outbox_status_enum" AS ENUM('pending', 'processing', 'succeeded', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN CREATE TYPE "public"."stitch_status_enum" AS ENUM('ACTIVE', 'PAUSED', 'ARCHIVED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN CREATE TYPE "public"."env_type_enum" AS ENUM('PRODUCTION', 'SANDBOX'); EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // ui_workspace
  `CREATE TABLE IF NOT EXISTS "ui_workspace" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "org_id" text NOT NULL,
    "name" varchar(255) NOT NULL,
    "env_type" "env_type_enum" DEFAULT 'PRODUCTION' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "ui_workspace_id_org_unique_idx" UNIQUE("id","org_id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ui_workspace_org_name_lower_unique_idx" ON "ui_workspace" USING btree ("org_id","env_type",lower("name"))`,
  `CREATE INDEX IF NOT EXISTS "ui_workspace_org_idx" ON "ui_workspace" USING btree ("org_id")`,
  `CREATE INDEX IF NOT EXISTS "ui_workspace_env_idx" ON "ui_workspace" USING btree ("org_id","env_type")`,

  // ui_workspace_connection
  `CREATE TABLE IF NOT EXISTS "ui_workspace_connection" (
    "workspace_id" uuid NOT NULL,
    "connection_id" uuid NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "ui_workspace_connection_workspace_id_connection_id_pk" PRIMARY KEY("workspace_id","connection_id")
  )`,
  `DO $$ BEGIN
    ALTER TABLE "ui_workspace_connection" ADD CONSTRAINT "ui_workspace_connection_workspace_id_ui_workspace_id_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "ui_workspace"("id") ON DELETE cascade;
    EXCEPTION WHEN duplicate_object THEN null;
  END $$`,
  `DO $$ BEGIN
    ALTER TABLE "ui_workspace_connection" ADD CONSTRAINT "ui_workspace_connection_connection_id_app_connection_id_fk"
      FOREIGN KEY ("connection_id") REFERENCES "app_connection"("id") ON DELETE cascade;
    EXCEPTION WHEN duplicate_object THEN null;
  END $$`,
  `CREATE INDEX IF NOT EXISTS "workspace_connection_conn_idx" ON "ui_workspace_connection" USING btree ("connection_id")`,

  // integration_stitch
  `CREATE TABLE IF NOT EXISTS "integration_stitch" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" varchar(255) NOT NULL,
    "org_id" text NOT NULL,
    "workspace_id" uuid NOT NULL,
    "src_connection_id" uuid NOT NULL,
    "dest_connection_id" uuid NOT NULL,
    "source_object" varchar(255) NOT NULL,
    "target_object" varchar(255) NOT NULL,
    "sync_condition" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "status" "stitch_status_enum" DEFAULT 'ACTIVE' NOT NULL,
    "sync_interval_minutes" integer DEFAULT 30 NOT NULL,
    "schedule_enabled" boolean DEFAULT true NOT NULL,
    "last_scheduled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "sync_interval_minutes_positive" CHECK ("integration_stitch"."sync_interval_minutes" > 0)
  )`,
  `DO $$ BEGIN
    ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_workspace_org_fk"
      FOREIGN KEY ("workspace_id","org_id") REFERENCES "ui_workspace"("id","org_id") ON DELETE cascade;
    EXCEPTION WHEN duplicate_object THEN null;
  END $$`,
  `DO $$ BEGIN
    ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_src_connection_fk"
      FOREIGN KEY ("src_connection_id") REFERENCES "app_connection"("id") ON DELETE cascade;
    EXCEPTION WHEN duplicate_object THEN null;
  END $$`,
  `DO $$ BEGIN
    ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_dest_connection_fk"
      FOREIGN KEY ("dest_connection_id") REFERENCES "app_connection"("id") ON DELETE cascade;
    EXCEPTION WHEN duplicate_object THEN null;
  END $$`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "stitch_name_workspace_unique_idx" ON "integration_stitch" USING btree ("workspace_id",lower("name"))`,
  `CREATE INDEX IF NOT EXISTS "stitch_workspace_idx" ON "integration_stitch" USING btree ("workspace_id")`,
  `CREATE INDEX IF NOT EXISTS "stitch_org_idx" ON "integration_stitch" USING btree ("org_id")`,
  `CREATE INDEX IF NOT EXISTS "stitch_src_conn_idx" ON "integration_stitch" USING btree ("src_connection_id")`,
  `CREATE INDEX IF NOT EXISTS "stitch_dest_conn_idx" ON "integration_stitch" USING btree ("dest_connection_id")`,
  `CREATE INDEX IF NOT EXISTS "stitch_status_idx" ON "integration_stitch" USING btree ("org_id","status")`,

  // field_mapping
  `CREATE TABLE IF NOT EXISTS "field_mapping" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "stitch_id" uuid NOT NULL,
    "source_canonical" varchar(100) NOT NULL,
    "mapping_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `DO $$ BEGIN
    ALTER TABLE "field_mapping" ADD CONSTRAINT "field_mapping_stitch_id_integration_stitch_id_fk"
      FOREIGN KEY ("stitch_id") REFERENCES "integration_stitch"("id") ON DELETE cascade;
    EXCEPTION WHEN duplicate_object THEN null;
  END $$`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "field_mapping_stitch_canonical_unique_idx" ON "field_mapping" USING btree ("stitch_id","source_canonical")`,

  // scheduler_outbox
  `CREATE TABLE IF NOT EXISTS "scheduler_outbox" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "stitch_id" uuid NOT NULL,
    "action" "scheduler_outbox_action_enum" NOT NULL,
    "status" "scheduler_outbox_status_enum" DEFAULT 'pending' NOT NULL,
    "attempts" smallint DEFAULT 0 NOT NULL,
    "next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
    "last_error" text,
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `DO $$ BEGIN
    ALTER TABLE "scheduler_outbox" ADD CONSTRAINT "scheduler_outbox_stitch_fk"
      FOREIGN KEY ("stitch_id") REFERENCES "integration_stitch"("id") ON DELETE cascade;
    EXCEPTION WHEN duplicate_object THEN null;
  END $$`,
  `CREATE INDEX IF NOT EXISTS "scheduler_outbox_poll_idx" ON "scheduler_outbox" USING btree ("next_retry_at") WHERE status = 'pending'`,
  `CREATE INDEX IF NOT EXISTS "scheduler_outbox_stitch_idx" ON "scheduler_outbox" USING btree ("stitch_id")`,
  
  // global_registry_outbox - must match migration 0005_icy_vision.sql
  `DO $$ BEGIN CREATE TYPE "public"."registry_outbox_action_enum" AS ENUM('UPSERT', 'DELETE'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN CREATE TYPE "public"."registry_outbox_entity_enum" AS ENUM('APP_CONNECTION', 'INTEGRATION_STITCH', 'FIELD_MAPPING'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN CREATE TYPE "public"."registry_outbox_status_enum" AS ENUM('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `CREATE TABLE IF NOT EXISTS "global_registry_outbox" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" varchar(255) NOT NULL,
    "entity_type" "registry_outbox_entity_enum" NOT NULL,
    "entity_id" uuid NOT NULL,
    "action" "registry_outbox_action_enum" NOT NULL,
    "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "status" "registry_outbox_status_enum" DEFAULT 'PENDING' NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
    "last_error" varchar(1000),
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "registry_outbox_poll_idx" ON "global_registry_outbox" USING btree ("next_retry_at") WHERE status = 'PENDING' OR status = 'FAILED'`,
  `CREATE INDEX IF NOT EXISTS "registry_outbox_tenant_idx" ON "global_registry_outbox" USING btree ("tenant_id")`
];

let failed = 0;
for (const stmt of statements) {
  try {
    await client.query(stmt);
    process.stdout.write('.');
  } catch (err) {
    console.error(`\nFAILED: ${err.message}\nSQL: ${stmt.slice(0, 120)}...`);
    failed++;
  }
}

await client.end();
console.log(`\n\nDone. ${statements.length - failed}/${statements.length} statements succeeded.`);
if (failed > 0) process.exit(1);
