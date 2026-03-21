-- Migration: Create integration_stitch and field_mapping tables for Phase 2 (Stitches & Mapping).
--
-- Tables:
--   integration_stitch — logical sync path between source and destination connections
--   field_mapping      — field-level transformation template per stitch + canonical type
--
-- Enums:
--   stitch_status_enum — ACTIVE, PAUSED, ARCHIVED

-- Enum -----------------------------------------------------------------
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

-- field_mapping --------------------------------------------------------
CREATE TABLE IF NOT EXISTS "field_mapping" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stitch_id"         uuid NOT NULL,
  "source_canonical"  varchar(100) NOT NULL,
  "mapping_rules"     jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at"        timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"        timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Foreign Keys ---------------------------------------------------------
-- Composite FK: workspace + org must match ui_workspace
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

DO $$ BEGIN
  ALTER TABLE "field_mapping"
    ADD CONSTRAINT "field_mapping_stitch_id_integration_stitch_id_fk"
    FOREIGN KEY ("stitch_id")
    REFERENCES "public"."integration_stitch"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- Indexes --------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "stitch_name_workspace_unique_idx"
  ON "integration_stitch" USING btree ("workspace_id", lower("name"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stitch_workspace_idx"   ON "integration_stitch" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stitch_org_idx"         ON "integration_stitch" USING btree ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stitch_src_conn_idx"    ON "integration_stitch" USING btree ("src_connection_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stitch_dest_conn_idx"   ON "integration_stitch" USING btree ("dest_connection_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stitch_status_idx"      ON "integration_stitch" USING btree ("org_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "field_mapping_stitch_canonical_unique_idx"
  ON "field_mapping" USING btree ("stitch_id", "source_canonical");
--> statement-breakpoint

-- updated_at triggers --------------------------------------------------
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

CREATE OR REPLACE TRIGGER "field_mapping_updated_at"
  BEFORE UPDATE ON "field_mapping"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
