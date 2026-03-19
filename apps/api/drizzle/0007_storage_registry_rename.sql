-- Migration: Update connection_storage_registry schema.
--
-- Changes applied:
--   1. Rename workspace_id → data_namespace (preserves all existing values).
--   2. Add schema_plan column (tracks which DBManager SchemaPlan was last applied).
--   3. Add unique constraint on data_namespace (each Postgres schema owned by one connection).
--   4. Create indexes registry_host_idx and registry_region_idx (missing from 0003).
--
-- Reversible: DOWN section is provided as comments at the bottom.

-- UP — Step 1: rename column only if workspace_id still exists ---------------
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'connection_storage_registry'
      AND column_name  = 'workspace_id'
  ) THEN
    ALTER TABLE "connection_storage_registry" RENAME COLUMN "workspace_id" TO "data_namespace";
  END IF;
END $$;
--> statement-breakpoint

-- UP — Step 2: add schema_plan (safe default covers all existing rows) -------
DO $$ BEGIN
  ALTER TABLE "connection_storage_registry"
    ADD COLUMN "schema_plan" varchar(64) NOT NULL DEFAULT 'NAMESPACE_ONLY';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
--> statement-breakpoint

-- UP — Step 3: unique constraint — no two connections share the same schema --
CREATE UNIQUE INDEX IF NOT EXISTS "registry_namespace_unique_idx"
    ON "connection_storage_registry" USING btree ("data_namespace");
--> statement-breakpoint

-- UP — Step 4: operational indexes (were in Drizzle schema but not in 0003) --
CREATE INDEX IF NOT EXISTS "registry_host_idx"
    ON "connection_storage_registry" USING btree ("database_host_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "registry_region_idx"
    ON "connection_storage_registry" USING btree ("region_context");

-- DOWN -----------------------------------------------------------------------
-- DROP INDEX  "registry_region_idx";
-- DROP INDEX  "registry_host_idx";
-- DROP INDEX  "registry_namespace_unique_idx";
-- ALTER TABLE "connection_storage_registry" DROP COLUMN "schema_plan";
-- ALTER TABLE "connection_storage_registry" RENAME COLUMN "data_namespace" TO "workspace_id";
