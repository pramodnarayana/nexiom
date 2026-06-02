CREATE TABLE "connection_sync_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"stream_name" varchar(200) NOT NULL,
	"state_document" jsonb DEFAULT '{"bookmarks":{},"versions":{},"currently_syncing":null}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "conn_sync_cursors_ds_stream_unique_idx" ON "connection_sync_cursors" USING btree ("data_source_id","stream_name");--> statement-breakpoint
CREATE INDEX "conn_sync_cursors_ds_idx" ON "connection_sync_cursors" USING btree ("data_source_id");