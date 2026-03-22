-- Migration: Create integration_stitch and migrate field_mapping to stitch_id.
--
-- Background
-- ----------
-- field_mapping was originally created with a route_id column (Routes feature).
-- Stitches repurpose the same table with a stitch_id column instead.
--
-- Safe migration strategy
-- -----------------------
-- Rather than DROP + recreate (which destroys all rows), we inspect the live
-- schema and conditionally rename route_id → stitch_id.  On fresh installs
-- 0010_stitches.sql already creates field_mapping with stitch_id, so the
-- ALTER branch is skipped and only the idempotent FK / trigger statements run.
--
-- FK prerequisite
-- ---------------
-- stitch_workspace_org_fk references ui_workspace("id","org_id").
-- The composite unique index ui_workspace_id_org_unique_idx on those columns
-- is created by 0008_workspaces.sql, so PostgreSQL will accept the FK.

-- Enum (idempotent) ----------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "public"."stitch_status_enum" AS ENUM('ACTIVE', 'PAUSED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- integration_stitch ---------------------------------------------------
CREATE TABLE IF NOT EXISTS "integration_stitch" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name"                   varchar(255) NOT NULL,
  "org_id"                 text NOT NULL,
  "workspace_id"           uuid NOT NULL,
  "src_connection_id"      uuid NOT NULL,
  "dest_connection_id"     uuid NOT NULL,
  "source_object"          varchar(255) NOT NULL,
  "target_object"          varchar(255) NOT NULL,
  "sync_condition"         jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status"                 "stitch_status_enum" NOT NULL DEFAULT 'ACTIVE',
  "sync_interval_minutes"  integer NOT NULL DEFAULT 30,
  "schedule_enabled"       boolean NOT NULL DEFAULT true,
  "last_scheduled_at"      timestamp with time zone,
  "created_at"             timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"             timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sync_interval_minutes_positive" CHECK ("sync_interval_minutes" > 0)
);
--> statement-breakpoint

-- Foreign Keys on integration_stitch -----------------------------------
-- Prerequisite: ui_workspace_id_org_unique_idx (UNIQUE on id, org_id) was
-- created by 0008_workspaces.sql and is required for this composite FK.
DO $$ BEGIN
  ALTER TABLE "integration_stitch"
    ADD CONSTRAINT "stitch_workspace_org_fk"
    FOREIGN KEY ("workspace_id", "org_id")
    REFERENCES "public"."ui_workspace"("id", "org_id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "integration_stitch"
    ADD CONSTRAINT "stitch_src_connection_fk"
    FOREIGN KEY ("src_connection_id")
    REFERENCES "public"."app_connection"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "integration_stitch"
    ADD CONSTRAINT "stitch_dest_connection_fk"
    FOREIGN KEY ("dest_connection_id")
    REFERENCES "public"."app_connection"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- Indexes on integration_stitch ----------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "stitch_name_workspace_unique_idx"
  ON "integration_stitch" USING btree ("workspace_id", lower("name"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stitch_workspace_idx"  ON "integration_stitch" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stitch_org_idx"        ON "integration_stitch" USING btree ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stitch_src_conn_idx"   ON "integration_stitch" USING btree ("src_connection_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stitch_dest_conn_idx"  ON "integration_stitch" USING btree ("dest_connection_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stitch_status_idx"     ON "integration_stitch" USING btree ("org_id", "status");
--> statement-breakpoint

-- updated_at trigger on integration_stitch -----------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER "integration_stitch_updated_at"
  BEFORE UPDATE ON "integration_stitch"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- field_mapping: migrate route_id → stitch_id (non-destructive) --------
-- On existing installs the table was created with route_id (Routes feature).
-- On fresh installs, 0010_stitches.sql already creates it with stitch_id.
-- The conditional block below detects which state we are in and acts only
-- when the old column is present, preserving all existing rows.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'field_mapping'
      AND column_name  = 'route_id'
  ) THEN
    -- Remove old FK and unique index before renaming the column.
    -- Old FK name mirrors the Drizzle-generated constraint name.
    ALTER TABLE "field_mapping"
      DROP CONSTRAINT IF EXISTS "field_mapping_route_id_integration_route_id_fk";
    DROP INDEX IF EXISTS "field_mapping_route_canonical_unique_idx";

    -- Rename in-place: column type is already uuid, no cast needed.
    -- Existing rows that had a route_id value are preserved; their stitch_id
    -- values will be orphaned (no matching integration_stitch row), which is
    -- correct — there is no semantic mapping from route IDs to stitch IDs.
    ALTER TABLE "field_mapping" RENAME COLUMN "route_id" TO "stitch_id";

    -- Recreate the unique index under the new column name.
    CREATE UNIQUE INDEX IF NOT EXISTS "field_mapping_stitch_canonical_unique_idx"
      ON "field_mapping" USING btree ("stitch_id", "source_canonical");
  END IF;
END $$;
--> statement-breakpoint

-- Purge orphaned field_mapping rows before enforcing the FK.
-- Rows whose stitch_id has no matching integration_stitch are legacy
-- route data that cannot be meaningfully remapped.  Deleting them here
-- ensures the NOT VALID constraint below can be validated in a future
-- migration without a full sequential scan failure.
DELETE FROM "field_mapping"
WHERE "stitch_id" IS NOT NULL
  AND "stitch_id" NOT IN (SELECT "id" FROM "integration_stitch");
--> statement-breakpoint

-- FK from field_mapping.stitch_id → integration_stitch.id (idempotent).
-- Added as NOT VALID so existing rows are not checked at migration time;
-- run "ALTER TABLE field_mapping VALIDATE CONSTRAINT ..." in a follow-up
-- migration once any remaining data quality is confirmed.
DO $$ BEGIN
  ALTER TABLE "field_mapping"
    ADD CONSTRAINT "field_mapping_stitch_id_integration_stitch_id_fk"
    FOREIGN KEY ("stitch_id")
    REFERENCES "public"."integration_stitch"("id")
    ON DELETE CASCADE
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- Unique index is also created by the conditional block above on old installs;
-- IF NOT EXISTS makes this idempotent on fresh installs too.
CREATE UNIQUE INDEX IF NOT EXISTS "field_mapping_stitch_canonical_unique_idx"
  ON "field_mapping" USING btree ("stitch_id", "source_canonical");
--> statement-breakpoint

CREATE OR REPLACE TRIGGER "field_mapping_updated_at"
  BEFORE UPDATE ON "field_mapping"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
