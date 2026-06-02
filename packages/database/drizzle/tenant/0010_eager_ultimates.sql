ALTER TABLE "connector_object_profiles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_connection" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ui_workspace_connection" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "connector_object_profiles" CASCADE;--> statement-breakpoint
DROP TABLE "app_connection" CASCADE;--> statement-breakpoint
DROP TABLE "ui_workspace_connection" CASCADE;--> statement-breakpoint
ALTER TABLE "ui_workspace" DROP CONSTRAINT "ui_workspace_id_org_unique_idx" CASCADE;--> statement-breakpoint
DROP INDEX "ui_workspace_org_name_lower_unique_idx";--> statement-breakpoint
DROP INDEX "ui_workspace_org_idx";--> statement-breakpoint
DROP INDEX "ui_workspace_env_idx";--> statement-breakpoint
DROP INDEX "sync_cursors_ds_stream_unique_idx";--> statement-breakpoint
DROP INDEX "sync_cursors_ds_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "ui_ws_org_name_lower_unique_idx" ON "ui_workspace" USING btree ("org_id","env_type",lower("name"));--> statement-breakpoint
CREATE INDEX "ui_ws_org_idx" ON "ui_workspace" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ui_ws_env_idx" ON "ui_workspace" USING btree ("org_id","env_type");--> statement-breakpoint
CREATE INDEX "idx_sync_cursors_ds" ON "sync_cursors" USING btree ("data_source_id");--> statement-breakpoint
ALTER TABLE "ui_workspace" ADD CONSTRAINT "ui_ws_id_org_unique_idx" UNIQUE("id","org_id");--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_unique_constraint" UNIQUE("data_source_id","stream_name");--> statement-breakpoint
ALTER TABLE "sync_cursors" DROP CONSTRAINT "sync_cursors_stitch_fk";--> statement-breakpoint
