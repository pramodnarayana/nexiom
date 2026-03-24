-- Migration: Create sync_cursors table (T046).
--
-- sync_cursors stores Singer-style polling state for each (stitch, stream) pair.
-- Keyed on (stitch_id, stream_name) — NOT (connection_id, stream_name) — so that
-- two stitches sharing the same source connection + stream name maintain independent
-- cursors and never advance each other's high-water mark.
--
-- state_document default mirrors SyncStateDocument shape (cursor-manager.types.ts):
--   bookmarks       — per-stream high-water marks + pagination offsets
--   versions        — per-stream ACTIVATE_VERSION counters (top-level, not inside bookmarks)
--   currently_syncing — set during a poll run; used for crash-resume detection

CREATE TABLE IF NOT EXISTS "sync_cursors" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stitch_id"      uuid NOT NULL,
  "stream_name"    varchar(200) NOT NULL,
  "state_document" jsonb NOT NULL DEFAULT '{"bookmarks":{},"versions":{},"currently_syncing":null}'::jsonb,
  "created_at"     timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"     timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "sync_cursors"
  ADD CONSTRAINT "sync_cursors_stitch_fk"
  FOREIGN KEY ("stitch_id")
  REFERENCES "public"."integration_stitch"("id")
  ON DELETE CASCADE;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "sync_cursors_stitch_stream_unique_idx"
  ON "sync_cursors" USING btree ("stitch_id", "stream_name");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sync_cursors_stitch_idx"
  ON "sync_cursors" USING btree ("stitch_id");
--> statement-breakpoint

-- updated_at trigger (reuses the set_updated_at() function from 0012_integration_stitch.sql)
CREATE OR REPLACE TRIGGER "sync_cursors_updated_at"
  BEFORE UPDATE ON "sync_cursors"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
