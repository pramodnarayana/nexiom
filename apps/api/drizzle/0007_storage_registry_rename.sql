-- Migration: Update connection_storage_registry schema.
--
-- Changes applied:
--   1. Rename workspace_id → data_namespace (preserves all existing values).
--   2. Add schema_plan column (tracks which DBManager SchemaPlan was last applied).
--   3. Add unique constraint on data_namespace (each Postgres schema owned by one connection).
--   4. Create indexes registry_host_idx and registry_region_idx (missing from 0003).
--
-- Reversible: DOWN section is provided as comments at the bottom.

-- UP — Step 1: rename column (preserves all values atomically) ---------------
ALTER TABLE "connection_storage_registry"
    RENAME COLUMN "workspace_id" TO "data_namespace";
--> statement-breakpoint

-- UP — Step 2: add schema_plan (safe default covers all existing rows) -------
ALTER TABLE "connection_storage_registry"
    ADD COLUMN "schema_plan" varchar(64) NOT NULL DEFAULT 'NAMESPACE_ONLY';
--> statement-breakpoint

-- UP — Step 3: unique constraint — no two connections share the same schema --
CREATE UNIQUE INDEX "registry_namespace_unique_idx"
    ON "connection_storage_registry" USING btree ("data_namespace");
--> statement-breakpoint

-- UP — Step 4: operational indexes (were in Drizzle schema but not in 0003) --
CREATE INDEX "registry_host_idx"
    ON "connection_storage_registry" USING btree ("database_host_id");
--> statement-breakpoint
CREATE INDEX "registry_region_idx"
    ON "connection_storage_registry" USING btree ("region_context");

-- DOWN -----------------------------------------------------------------------
-- DROP INDEX  "registry_region_idx";
-- DROP INDEX  "registry_host_idx";
-- DROP INDEX  "registry_namespace_unique_idx";
-- ALTER TABLE "connection_storage_registry" DROP COLUMN "schema_plan";
-- ALTER TABLE "connection_storage_registry" RENAME COLUMN "data_namespace" TO "workspace_id";
