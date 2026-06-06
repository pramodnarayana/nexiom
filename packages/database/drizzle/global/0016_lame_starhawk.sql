ALTER TABLE "canonical_mappings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "canonical_mappings" CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "updatedAt" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD COLUMN "source_data_source_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_source_data_source_fk" FOREIGN KEY ("source_data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stitch_identity_unique_idx" ON "integration_stitch" USING btree ("workspace_id","source_data_source_id","dest_data_source_id","canonical_object");--> statement-breakpoint
CREATE INDEX "stitch_source_ds_idx" ON "integration_stitch" USING btree ("source_data_source_id");--> statement-breakpoint
CREATE INDEX "shard_status_region_idx" ON "shard_registry" USING btree ("status","region_context","current_tenants");