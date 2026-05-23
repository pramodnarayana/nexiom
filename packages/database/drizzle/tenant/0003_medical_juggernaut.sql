CREATE TABLE "data_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"app_name" varchar(100) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"env_type" "env_type_enum" DEFAULT 'PRODUCTION' NOT NULL,
	"vendor_tenant_id" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_plan" varchar(64) DEFAULT 'NAMESPACE_ONLY' NOT NULL,
	"schema_name" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduler_outbox" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "scheduler_outbox" CASCADE;--> statement-breakpoint
ALTER TABLE "connector_object_profiles" DROP CONSTRAINT "connector_object_profiles_connection_id_app_connection_id_fk";
--> statement-breakpoint
ALTER TABLE "global_entity_map" DROP CONSTRAINT "global_entity_map_source_app_id_app_connection_id_fk";
--> statement-breakpoint
ALTER TABLE "global_entity_map" DROP CONSTRAINT "global_entity_map_dest_app_id_app_connection_id_fk";
--> statement-breakpoint
ALTER TABLE "integration_stitch" DROP CONSTRAINT "stitch_src_connection_fk";
--> statement-breakpoint
ALTER TABLE "integration_stitch" DROP CONSTRAINT "stitch_dest_connection_fk";
--> statement-breakpoint
ALTER TABLE "sync_cursors" DROP CONSTRAINT "sync_cursors_stitch_fk";
--> statement-breakpoint
DROP INDEX "canonical_mapping_unique_idx";--> statement-breakpoint
DROP INDEX "cop_connection_idx";--> statement-breakpoint
DROP INDEX "gem_source_app_idx";--> statement-breakpoint
DROP INDEX "gem_dest_app_idx";--> statement-breakpoint
DROP INDEX "stitch_src_conn_idx";--> statement-breakpoint
DROP INDEX "stitch_dest_conn_idx";--> statement-breakpoint
DROP INDEX "gem_unique_mapping_idx";--> statement-breakpoint
DROP INDEX "gem_src_lookup_idx";--> statement-breakpoint
DROP INDEX "gem_dest_lookup_idx";--> statement-breakpoint
ALTER TABLE "canonical_mappings" ADD COLUMN "tenant_id" varchar(100);--> statement-breakpoint
ALTER TABLE "connector_object_profiles" ADD COLUMN "data_source_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "global_entity_map" ADD COLUMN "source_data_source_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "global_entity_map" ADD COLUMN "dest_data_source_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD COLUMN "src_data_source_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD COLUMN "dest_data_source_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "connector_object_profiles" DROP CONSTRAINT "connector_object_profiles_connection_id_object_name_pk";--> statement-breakpoint
ALTER TABLE "connector_object_profiles" ADD CONSTRAINT "connector_object_profiles_data_source_id_object_name_pk" PRIMARY KEY("data_source_id","object_name");--> statement-breakpoint

CREATE INDEX "ds_tenant_idx" ON "data_source" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ds_tenant_external_id_idx" ON "data_source" USING btree ("tenant_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ds_tenant_app_display_name_lower_idx" ON "data_source" USING btree ("tenant_id","app_name",lower("display_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "ds_tenant_vendor_id_idx" ON "data_source" USING btree ("tenant_id","app_name","env_type","vendor_tenant_id");--> statement-breakpoint
ALTER TABLE "connector_object_profiles" ADD CONSTRAINT "connector_object_profiles_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_entity_map" ADD CONSTRAINT "global_entity_map_source_data_source_id_data_source_id_fk" FOREIGN KEY ("source_data_source_id") REFERENCES "public"."data_source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_entity_map" ADD CONSTRAINT "global_entity_map_dest_data_source_id_data_source_id_fk" FOREIGN KEY ("dest_data_source_id") REFERENCES "public"."data_source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_src_data_source_fk" FOREIGN KEY ("src_data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_dest_data_source_fk" FOREIGN KEY ("dest_data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_stitch_fk" FOREIGN KEY ("stitch_id") REFERENCES "public"."integration_stitch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_mapping_tenant_idx" ON "canonical_mappings" USING btree ("tenant_id","app_name","category","entity","view_mode","version") WHERE "canonical_mappings"."tenant_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_mapping_global_idx" ON "canonical_mappings" USING btree ("app_name","category","entity","view_mode","version") WHERE "canonical_mappings"."tenant_id" IS NULL;--> statement-breakpoint
CREATE INDEX "gem_source_ds_idx" ON "global_entity_map" USING btree ("source_data_source_id");--> statement-breakpoint
CREATE INDEX "gem_dest_ds_idx" ON "global_entity_map" USING btree ("dest_data_source_id");--> statement-breakpoint
CREATE INDEX "stitch_src_ds_idx" ON "integration_stitch" USING btree ("src_data_source_id");--> statement-breakpoint
CREATE INDEX "stitch_dest_ds_idx" ON "integration_stitch" USING btree ("dest_data_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gem_unique_mapping_idx" ON "global_entity_map" USING btree ("stitch_id","source_data_source_id","source_entity_id","dest_data_source_id","dest_entity_type");--> statement-breakpoint
CREATE INDEX "gem_src_lookup_idx" ON "global_entity_map" USING btree ("source_entity_id","source_data_source_id");--> statement-breakpoint
CREATE INDEX "gem_dest_lookup_idx" ON "global_entity_map" USING btree ("dest_entity_id","dest_data_source_id");--> statement-breakpoint
ALTER TABLE "connector_object_profiles" DROP COLUMN "connection_id";--> statement-breakpoint
ALTER TABLE "global_entity_map" DROP COLUMN "source_app_id";--> statement-breakpoint
ALTER TABLE "global_entity_map" DROP COLUMN "dest_app_id";--> statement-breakpoint
ALTER TABLE "integration_stitch" DROP COLUMN "src_connection_id";--> statement-breakpoint
ALTER TABLE "integration_stitch" DROP COLUMN "dest_connection_id";--> statement-breakpoint