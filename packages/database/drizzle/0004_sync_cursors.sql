CREATE TABLE IF NOT EXISTS "sync_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stitch_id" uuid NOT NULL,
	"stream_name" varchar(200) NOT NULL,
	"state_document" jsonb DEFAULT '{"bookmarks":{},"versions":{},"currently_syncing":null}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_stitch_fk" FOREIGN KEY ("stitch_id") REFERENCES "public"."integration_stitch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_cursors_stitch_stream_unique_idx" ON "sync_cursors" USING btree ("stitch_id","stream_name");--> statement-breakpoint
-- Trigger: keep updated_at current on every row update regardless of ORM layer.
-- Drizzle's $onUpdate() only fires via the ORM; raw SQL writes (e.g. SchedulerWorker
-- UPSERT) would leave updated_at stale without this trigger.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_cursors_set_updated_at
BEFORE UPDATE ON "sync_cursors"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
