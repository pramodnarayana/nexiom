ALTER TYPE "public"."connection_status_enum" ADD VALUE 'PROVISIONING';--> statement-breakpoint
ALTER TYPE "public"."connection_status_enum" ADD VALUE 'FAILED';--> statement-breakpoint
ALTER TYPE "public"."pipeline_status_enum" ADD VALUE 'DISMISSED';--> statement-breakpoint
CREATE INDEX "gem_source_app_idx" ON "global_entity_map" USING btree ("source_app_id");--> statement-breakpoint
CREATE INDEX "gem_dest_app_idx" ON "global_entity_map" USING btree ("dest_app_id");