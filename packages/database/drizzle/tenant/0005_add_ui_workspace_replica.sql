-- Migration 0005: Add ui_workspace replica table to tenant DB and restore stitch_workspace_org_fk.
-- ui_workspace is a control-plane entity that also needs to exist in the tenant DB
-- because integration_stitch has a composite FK to (workspace_id, org_id) -> ui_workspace.
-- The workspace row is replicated via the global_registry_outbox (UI_WORKSPACE entity type).

CREATE TABLE IF NOT EXISTS "ui_workspace" (
    "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "org_id"      text        NOT NULL,
    "name"        varchar(255) NOT NULL,
    "env_type"    "env_type_enum" DEFAULT 'PRODUCTION' NOT NULL,
    "created_at"  timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at"  timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ui_workspace_org_name_lower_unique_idx"
    ON "ui_workspace" ("org_id", "env_type", lower("name"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ui_workspace_id_org_unique_idx"
    ON "ui_workspace" ("id", "org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ui_workspace_org_idx"
    ON "ui_workspace" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ui_workspace_env_idx"
    ON "ui_workspace" ("org_id", "env_type");
--> statement-breakpoint

-- Restore the composite FK on integration_stitch that was dropped in migration 0004.
-- Now that ui_workspace table exists in the tenant DB, this constraint is valid again.
DO $$ BEGIN
    ALTER TABLE "integration_stitch"
        ADD CONSTRAINT "stitch_workspace_org_fk"
        FOREIGN KEY ("workspace_id", "org_id")
        REFERENCES "ui_workspace"("id", "org_id")
        ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
