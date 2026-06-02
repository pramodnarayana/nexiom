ALTER TABLE "connection_sync_cursors" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "connection_sync_cursors" CASCADE;--> statement-breakpoint
ALTER TABLE "sync_cursors" RENAME COLUMN "stitch_id" TO "data_source_id";--> statement-breakpoint
DROP INDEX "sync_cursors_stitch_stream_unique_idx";--> statement-breakpoint
DROP INDEX "sync_cursors_stitch_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "sync_cursors_ds_stream_unique_idx" ON "sync_cursors" USING btree ("data_source_id","stream_name");--> statement-breakpoint
CREATE INDEX "sync_cursors_ds_idx" ON "sync_cursors" USING btree ("data_source_id");