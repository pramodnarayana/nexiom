-- Migration: Consolidate tenant_id to reference organization.id
-- Replaces the old shadow `tenant` table FK with a direct FK to `organization.id`.
-- Since we are pre-production, we truncate app_connection to avoid data mapping complexity.

-- Step 1: Drop dependent indexes first
DROP INDEX IF EXISTS "tenant_status_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "tenant_external_id_unique_idx";--> statement-breakpoint

-- Step 2: Drop the old FK constraints (to tenant and also the one from 0001)
ALTER TABLE "app_connection" DROP CONSTRAINT IF EXISTS "app_connection_tenant_id_tenant_id_fk";--> statement-breakpoint

-- Step 3: Guard: abort if app_connection has rows that would be lost.
-- Operators must manually backfill tenant_id → organization.id mapping before running this migration.
DO $$
DECLARE
  row_count integer;
BEGIN
  SELECT COUNT(*) INTO row_count FROM "app_connection";
  IF row_count > 0 THEN
    RAISE EXCEPTION
      'Migration aborted: app_connection has % rows. '
      'Backfill tenant_id values to matching organization.id values before re-running.',
      row_count;
  END IF;
END $$;--> statement-breakpoint

-- Step 4: Alter tenant_id column from uuid to text
ALTER TABLE "app_connection" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;--> statement-breakpoint

-- Step 5: Add the new FK referencing organization.id
ALTER TABLE "app_connection" ADD CONSTRAINT "app_connection_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Step 6: Recreate indexes
CREATE INDEX "tenant_status_idx" ON "app_connection" USING btree ("tenant_id", "status");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_external_id_unique_idx" ON "app_connection" USING btree ("tenant_id", "external_id");--> statement-breakpoint

-- Step 7: Guard: drop the orphaned shadow tenant table only if empty
DO $$
DECLARE
  tenant_count integer;
BEGIN
  -- Only check if the table actually exists to avoid errors on re-runs
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenant') THEN
    EXECUTE 'SELECT COUNT(*) FROM "tenant"' INTO tenant_count;
    IF tenant_count > 0 THEN
      RAISE EXCEPTION
        'Migration aborted: shadow "tenant" table has % rows. '
        'Backfill/migrate these to "organization" before dropping.',
        tenant_count;
    END IF;
    DROP TABLE "tenant";
  END IF;
END $$;--> statement-breakpoint

-- Step 8: Also drop connection from 0001 if it still exists
ALTER TABLE "app_connection" DROP CONSTRAINT IF EXISTS "app_connection_tenant_id_tenant_id_fk";
