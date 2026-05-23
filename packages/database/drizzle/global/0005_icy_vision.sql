CREATE TYPE "public"."registry_outbox_action_enum" AS ENUM('UPSERT', 'DELETE');--> statement-breakpoint
CREATE TYPE "public"."registry_outbox_entity_enum" AS ENUM('APP_CONNECTION', 'INTEGRATION_STITCH', 'FIELD_MAPPING');--> statement-breakpoint
CREATE TYPE "public"."registry_outbox_status_enum" AS ENUM('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."auth_type_enum" AS ENUM('OAUTH2', 'API_KEY', 'BASIC');--> statement-breakpoint
CREATE TYPE "public"."connection_status_enum" AS ENUM('ACTIVE', 'INACTIVE', 'REVOKED', 'EXPIRED', 'PROVISIONING', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."env_type_enum" AS ENUM('PRODUCTION', 'SANDBOX');--> statement-breakpoint
CREATE TYPE "public"."scheduler_outbox_action_enum" AS ENUM('CREATED', 'UPDATED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."scheduler_outbox_status_enum" AS ENUM('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."stitch_status_enum" AS ENUM('ACTIVE', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"auth_type" "auth_type_enum" NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone,
	"status" "connection_status_enum" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "global_registry_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(255) NOT NULL,
	"entity_type" "registry_outbox_entity_enum" NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" "registry_outbox_action_enum" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "registry_outbox_status_enum" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" varchar(1000),
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
	"src_data_source_id" uuid NOT NULL,
	"dest_data_source_id" uuid NOT NULL,
	"source_object" varchar(255) NOT NULL,
	"target_object" varchar(255) NOT NULL,
	"sync_condition" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "stitch_status_enum" DEFAULT 'ACTIVE' NOT NULL,
	"sync_interval_minutes" integer DEFAULT 30 NOT NULL,
	"schedule_enabled" boolean DEFAULT true NOT NULL,
	"last_scheduled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_interval_minutes_positive" CHECK ("integration_stitch"."sync_interval_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "scheduler_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stitch_id" uuid NOT NULL,
	"action" "scheduler_outbox_action_enum" NOT NULL,
	"status" "scheduler_outbox_status_enum" DEFAULT 'PENDING' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ui_workspace_data_source" (
	"workspace_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ui_workspace_data_source_workspace_id_data_source_id_pk" PRIMARY KEY("workspace_id","data_source_id")
);
--> statement-breakpoint
CREATE TABLE "ui_workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"env_type" "env_type_enum" DEFAULT 'PRODUCTION' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ui_workspace_id_org_unique_idx" UNIQUE("id","org_id")
);
--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_mapping" ADD CONSTRAINT "field_mapping_stitch_id_integration_stitch_id_fk" FOREIGN KEY ("stitch_id") REFERENCES "public"."integration_stitch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_workspace_org_fk" FOREIGN KEY ("workspace_id","org_id") REFERENCES "public"."ui_workspace"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_src_data_source_fk" FOREIGN KEY ("src_data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_dest_data_source_fk" FOREIGN KEY ("dest_data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_outbox" ADD CONSTRAINT "scheduler_outbox_stitch_fk" FOREIGN KEY ("stitch_id") REFERENCES "public"."integration_stitch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_workspace_data_source" ADD CONSTRAINT "ui_workspace_data_source_workspace_id_ui_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."ui_workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_workspace_data_source" ADD CONSTRAINT "ui_workspace_data_source_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cred_data_source_idx" ON "credential" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "cred_status_idx" ON "credential" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cred_expires_at_idx" ON "credential" USING btree ("expires_at") WHERE "credential"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ds_tenant_idx" ON "data_source" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ds_tenant_external_id_idx" ON "data_source" USING btree ("tenant_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ds_tenant_app_display_name_lower_idx" ON "data_source" USING btree ("tenant_id","app_name",lower("display_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "ds_tenant_vendor_id_idx" ON "data_source" USING btree ("tenant_id","app_name","env_type","vendor_tenant_id");--> statement-breakpoint
CREATE INDEX "registry_outbox_poll_idx" ON "global_registry_outbox" USING btree ("next_retry_at") WHERE status = 'PENDING' OR status = 'FAILED';--> statement-breakpoint
CREATE INDEX "registry_outbox_tenant_idx" ON "global_registry_outbox" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_mapping_stitch_canonical_unique_idx" ON "field_mapping" USING btree ("stitch_id","source_canonical");--> statement-breakpoint
CREATE UNIQUE INDEX "stitch_name_workspace_unique_idx" ON "integration_stitch" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "stitch_workspace_idx" ON "integration_stitch" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "stitch_org_idx" ON "integration_stitch" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "stitch_src_ds_idx" ON "integration_stitch" USING btree ("src_data_source_id");--> statement-breakpoint
CREATE INDEX "stitch_dest_ds_idx" ON "integration_stitch" USING btree ("dest_data_source_id");--> statement-breakpoint
CREATE INDEX "stitch_status_idx" ON "integration_stitch" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "scheduler_outbox_poll_idx" ON "scheduler_outbox" USING btree ("next_retry_at") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "scheduler_outbox_stitch_idx" ON "scheduler_outbox" USING btree ("stitch_id");--> statement-breakpoint
CREATE INDEX "workspace_data_source_ds_idx" ON "ui_workspace_data_source" USING btree ("data_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ui_workspace_org_name_lower_unique_idx" ON "ui_workspace" USING btree ("org_id","env_type",lower("name"));--> statement-breakpoint
CREATE INDEX "ui_workspace_org_idx" ON "ui_workspace" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ui_workspace_env_idx" ON "ui_workspace" USING btree ("org_id","env_type");