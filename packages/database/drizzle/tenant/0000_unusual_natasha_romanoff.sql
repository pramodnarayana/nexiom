CREATE TYPE "public"."pipeline_layer_enum" AS ENUM('L1', 'L2', 'L3', 'L4', 'L5', 'L6');--> statement-breakpoint
CREATE TYPE "public"."pipeline_status_enum" AS ENUM('RECEIVED', 'PROCESSING', 'REPLICATED', 'NORMALIZED', 'SKIPPED', 'PENDING', 'SUCCESS', 'FAIL', 'RETRY', 'DISMISSED', 'DEFERRED_DEPENDENCY');--> statement-breakpoint
CREATE TYPE "public"."scheduler_outbox_action_enum" AS ENUM('CREATED', 'UPDATED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."scheduler_outbox_status_enum" AS ENUM('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."stitch_status_enum" AS ENUM('ACTIVE', 'INACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."env_type_enum" AS ENUM('PRODUCTION', 'SANDBOX');--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"title" varchar(255) DEFAULT 'New Conversation' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_conversations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(50) NOT NULL,
	"content" text NOT NULL,
	"status" varchar(50) DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_messages_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "global_entity_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stitch_id" uuid NOT NULL,
	"source_app_name" varchar(100) NOT NULL,
	"source_data_source_id" uuid NOT NULL,
	"source_org_id" varchar(255) NOT NULL,
	"source_org_name" varchar(255),
	"source_entity_type" varchar(100) NOT NULL,
	"source_entity_id" varchar(255) NOT NULL,
	"source_ref_layer" varchar(10) NOT NULL,
	"source_trace_id" uuid NOT NULL,
	"dest_app_name" varchar(100) NOT NULL,
	"dest_data_source_id" uuid NOT NULL,
	"dest_org_id" varchar(255) NOT NULL,
	"dest_org_name" varchar(255),
	"dest_entity_type" varchar(100) NOT NULL,
	"dest_entity_id" varchar(255) NOT NULL,
	"dest_ref_layer" varchar(10) NOT NULL,
	"dest_trace_id" uuid NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gem_unique_mapping_idx" UNIQUE("stitch_id","source_data_source_id","source_entity_id","dest_data_source_id","dest_entity_type")
);
--> statement-breakpoint
CREATE TABLE "data_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"app_name" varchar(100) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"env_type" "env_type_enum" DEFAULT 'PRODUCTION' NOT NULL,
	"organization_id" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_plan" varchar(64) DEFAULT 'NAMESPACE_ONLY' NOT NULL,
	"schema_name" varchar(100),
	"sync_interval_minutes" integer DEFAULT 30 NOT NULL,
	"schedule_enabled" boolean DEFAULT true NOT NULL,
	"last_scheduled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stitch_id" uuid NOT NULL,
	"source_canonical" varchar(100) NOT NULL,
	"mapping_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_stitch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_data_source_id" uuid NOT NULL,
	"dest_data_source_id" uuid NOT NULL,
	"canonical_object" varchar(255) NOT NULL,
	"target_object" varchar(255) NOT NULL,
	"sync_condition" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "stitch_status_enum" DEFAULT 'INACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ui_workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"env_type" "env_type_enum" DEFAULT 'PRODUCTION' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ui_ws_id_org_unique_idx" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"stream_name" varchar(200) NOT NULL,
	"state_document" jsonb DEFAULT '{"bookmarks":{},"versions":{},"currently_syncing":null}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_cursors_unique_constraint" UNIQUE("data_source_id","stream_name")
);
--> statement-breakpoint
CREATE TABLE "canonical_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(100),
	"app_name" varchar(100) NOT NULL,
	"category" varchar(50) NOT NULL,
	"entity" varchar(100) NOT NULL,
	"view_mode" varchar(50) NOT NULL,
	"version" varchar(50) DEFAULT 'v1' NOT NULL,
	"mapping_config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"action" "scheduler_outbox_action_enum" NOT NULL,
	"status" "scheduler_outbox_status_enum" DEFAULT 'PENDING' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_message" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."ai_conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_entity_map" ADD CONSTRAINT "global_entity_map_stitch_id_integration_stitch_id_fk" FOREIGN KEY ("stitch_id") REFERENCES "public"."integration_stitch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_entity_map" ADD CONSTRAINT "global_entity_map_source_data_source_id_data_source_id_fk" FOREIGN KEY ("source_data_source_id") REFERENCES "public"."data_source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_entity_map" ADD CONSTRAINT "global_entity_map_dest_data_source_id_data_source_id_fk" FOREIGN KEY ("dest_data_source_id") REFERENCES "public"."data_source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_mapping" ADD CONSTRAINT "field_mapping_stitch_id_integration_stitch_id_fk" FOREIGN KEY ("stitch_id") REFERENCES "public"."integration_stitch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_workspace_org_fk" FOREIGN KEY ("workspace_id","org_id") REFERENCES "public"."ui_workspace"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_source_data_source_fk" FOREIGN KEY ("source_data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_dest_data_source_fk" FOREIGN KEY ("dest_data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_outbox" ADD CONSTRAINT "scheduler_outbox_data_source_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conv_tenant_idx" ON "ai_conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ai_conv_created_idx" ON "ai_conversations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_msg_conv_idx" ON "ai_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ai_msg_tenant_idx" ON "ai_messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ai_msg_timeline_idx" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "gem_src_lookup_idx" ON "global_entity_map" USING btree ("source_entity_id","source_data_source_id");--> statement-breakpoint
CREATE INDEX "gem_dest_lookup_idx" ON "global_entity_map" USING btree ("dest_entity_id","dest_data_source_id");--> statement-breakpoint
CREATE INDEX "gem_source_ds_idx" ON "global_entity_map" USING btree ("source_data_source_id");--> statement-breakpoint
CREATE INDEX "gem_dest_ds_idx" ON "global_entity_map" USING btree ("dest_data_source_id");--> statement-breakpoint
CREATE INDEX "gem_src_trace_idx" ON "global_entity_map" USING btree ("source_trace_id");--> statement-breakpoint
CREATE INDEX "gem_dest_trace_idx" ON "global_entity_map" USING btree ("dest_trace_id");--> statement-breakpoint
CREATE INDEX "gem_stitch_idx" ON "global_entity_map" USING btree ("stitch_id");--> statement-breakpoint
CREATE INDEX "ds_tenant_idx" ON "data_source" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ds_tenant_external_id_idx" ON "data_source" USING btree ("tenant_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ds_tenant_app_display_name_lower_idx" ON "data_source" USING btree ("tenant_id","app_name",lower("display_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "ds_tenant_organization_id_idx" ON "data_source" USING btree ("tenant_id","app_name","env_type","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_mapping_stitch_canonical_unique_idx" ON "field_mapping" USING btree ("stitch_id","source_canonical");--> statement-breakpoint
CREATE UNIQUE INDEX "stitch_name_workspace_unique_idx" ON "integration_stitch" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "stitch_identity_unique_idx" ON "integration_stitch" USING btree ("workspace_id","source_data_source_id","dest_data_source_id","canonical_object");--> statement-breakpoint
CREATE INDEX "stitch_workspace_idx" ON "integration_stitch" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "stitch_org_idx" ON "integration_stitch" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "stitch_source_ds_idx" ON "integration_stitch" USING btree ("source_data_source_id");--> statement-breakpoint
CREATE INDEX "stitch_dest_ds_idx" ON "integration_stitch" USING btree ("dest_data_source_id");--> statement-breakpoint
CREATE INDEX "stitch_status_idx" ON "integration_stitch" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ui_ws_org_name_lower_unique_idx" ON "ui_workspace" USING btree ("org_id","env_type",lower("name"));--> statement-breakpoint
CREATE INDEX "ui_ws_org_idx" ON "ui_workspace" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ui_ws_env_idx" ON "ui_workspace" USING btree ("org_id","env_type");--> statement-breakpoint
CREATE INDEX "idx_sync_cursors_ds" ON "sync_cursors" USING btree ("data_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_mapping_tenant_idx" ON "canonical_mappings" USING btree ("tenant_id","app_name","category","entity","view_mode","version") WHERE "canonical_mappings"."tenant_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_mapping_global_idx" ON "canonical_mappings" USING btree ("app_name","category","entity","view_mode","version") WHERE "canonical_mappings"."tenant_id" IS NULL;--> statement-breakpoint
CREATE INDEX "scheduler_outbox_poll_idx" ON "scheduler_outbox" USING btree ("next_retry_at") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "scheduler_outbox_data_source_idx" ON "scheduler_outbox" USING btree ("data_source_id");