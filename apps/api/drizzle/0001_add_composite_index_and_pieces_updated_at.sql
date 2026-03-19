-- Migration: 0001_add_composite_index_and_pieces_updated_at
-- Adds a composite covering index on app_connection so the paginated
-- active-connections listing (filter: tenant_id + status, order: created_at DESC, id DESC)
-- can satisfy both the WHERE and ORDER BY from a single index scan.
--
-- Also adds the updated_at column to the pieces table, which was missing
-- from the initial schema (0000_tricky_hawkeye.sql).
-- Environments that already ran 0000 will receive these changes here.

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_status_created_at_id_idx" ON "app_connection" USING btree ("tenant_id","status","created_at" DESC,"id" DESC);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pieces" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
