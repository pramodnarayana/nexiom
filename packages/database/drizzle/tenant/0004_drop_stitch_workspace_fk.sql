-- Migration: Drop stitch_workspace_org_fk from tenant DB's integration_stitch table.
-- The ui_workspace table is a control-plane entity and is NOT replicated to tenant DBs.
-- The pipeline worker only needs src_data_source_id/dest_data_source_id/source_object/
-- target_object for routing — it never needs to resolve the workspace FK.
-- Dropping this constraint allows INTEGRATION_STITCH rows to replicate correctly.
DO $$ BEGIN
  ALTER TABLE "integration_stitch" DROP CONSTRAINT IF EXISTS "stitch_workspace_org_fk";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
