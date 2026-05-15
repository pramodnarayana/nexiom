ALTER TABLE "ai_conversations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_messages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connector_object_profiles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "global_entity_map" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "field_mapping" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_stitch" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scheduler_outbox" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_cursors" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_connection" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ui_workspace_connection" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ui_workspace" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ai_conversations" CASCADE;--> statement-breakpoint
DROP TABLE "ai_messages" CASCADE;--> statement-breakpoint
DROP TABLE "connector_object_profiles" CASCADE;--> statement-breakpoint
DROP TABLE "global_entity_map" CASCADE;--> statement-breakpoint
DROP TABLE "field_mapping" CASCADE;--> statement-breakpoint
DROP TABLE "integration_stitch" CASCADE;--> statement-breakpoint
DROP TABLE "scheduler_outbox" CASCADE;--> statement-breakpoint
DROP TABLE "sync_cursors" CASCADE;--> statement-breakpoint
DROP TABLE "app_connection" CASCADE;--> statement-breakpoint
DROP TABLE "ui_workspace_connection" CASCADE;--> statement-breakpoint
DROP TABLE "ui_workspace" CASCADE;--> statement-breakpoint
DROP INDEX "canonical_mapping_unique_idx";--> statement-breakpoint
ALTER TABLE "canonical_mappings" ADD COLUMN "tenant_id" varchar(100);--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_mapping_tenant_idx" ON "canonical_mappings" USING btree ("tenant_id","app_name","category","entity","view_mode","version") WHERE "canonical_mappings"."tenant_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_mapping_global_idx" ON "canonical_mappings" USING btree ("app_name","category","entity","view_mode","version") WHERE "canonical_mappings"."tenant_id" IS NULL;--> statement-breakpoint
DROP TYPE "public"."pipeline_layer_enum";--> statement-breakpoint
DROP TYPE "public"."pipeline_status_enum";--> statement-breakpoint
DROP TYPE "public"."scheduler_outbox_action_enum";--> statement-breakpoint
DROP TYPE "public"."scheduler_outbox_status_enum";--> statement-breakpoint
DROP TYPE "public"."stitch_status_enum";--> statement-breakpoint
DROP TYPE "public"."auth_type_enum";--> statement-breakpoint
DROP TYPE "public"."connection_status_enum";--> statement-breakpoint
DROP TYPE "public"."env_type_enum";