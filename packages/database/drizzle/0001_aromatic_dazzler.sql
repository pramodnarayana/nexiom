ALTER TYPE "public"."connection_status_enum" ADD VALUE 'PROVISIONING';--> statement-breakpoint
ALTER TYPE "public"."connection_status_enum" ADD VALUE 'FAILED';--> statement-breakpoint
ALTER TYPE "public"."pipeline_status_enum" ADD VALUE 'DISMISSED';--> statement-breakpoint
CREATE INDEX "gem_source_app_idx" ON "global_entity_map" USING btree ("source_app_id");--> statement-breakpoint
CREATE INDEX "gem_dest_app_idx" ON "global_entity_map" USING btree ("dest_app_id");--> statement-breakpoint
ALTER TABLE "sync_log" DROP CONSTRAINT "uq_sync_log_trace_layer_status";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_log_routed" ON "sync_log" ("trace_id", "route_id", "layer", "status") WHERE "route_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_log_unrouted" ON "sync_log" ("trace_id", "layer", "status") WHERE "route_id" IS NULL;