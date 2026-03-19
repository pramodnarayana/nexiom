-- Fix workspace name uniqueness: allow the same name in different env types (PRODUCTION vs SANDBOX).
-- Replaces (org_id, lower(name)) with (org_id, env_type, lower(name)) atomically so there
-- is no window where the constraint is absent.
DO $$ BEGIN
  CREATE UNIQUE INDEX "ui_workspace_org_name_lower_unique_idx_new"
    ON "ui_workspace" USING btree ("org_id", "env_type", lower("name"));
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  DROP INDEX IF EXISTS "ui_workspace_org_name_lower_unique_idx";
  ALTER INDEX IF EXISTS "ui_workspace_org_name_lower_unique_idx_new"
    RENAME TO "ui_workspace_org_name_lower_unique_idx";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
