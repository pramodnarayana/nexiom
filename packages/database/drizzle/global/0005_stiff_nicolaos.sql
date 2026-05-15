CREATE TYPE "public"."auth_type_enum" AS ENUM('OAUTH2', 'API_KEY', 'BASIC');--> statement-breakpoint
CREATE TYPE "public"."connection_status_enum" AS ENUM('ACTIVE', 'INACTIVE', 'REVOKED', 'EXPIRED', 'PROVISIONING', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."env_type_enum" AS ENUM('PRODUCTION', 'SANDBOX');--> statement-breakpoint
CREATE TYPE "public"."scheduler_outbox_action_enum" AS ENUM('created', 'updated', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."scheduler_outbox_status_enum" AS ENUM('pending', 'processing', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."stitch_status_enum" AS ENUM('ACTIVE', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "app_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"app_name" varchar(100) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"auth_type" "auth_type_enum" NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone,
	"status" "connection_status_enum" DEFAULT 'ACTIVE' NOT NULL,
	"env_type" "env_type_enum" DEFAULT 'PRODUCTION' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"schema_plan" varchar(64) DEFAULT 'NAMESPACE_ONLY' NOT NULL,
	"schema_name" varchar(100),
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
	"src_connection_id" uuid NOT NULL,
	"dest_connection_id" uuid NOT NULL,
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
	"status" "scheduler_outbox_status_enum" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ui_workspace_connection" (
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ui_workspace_connection_workspace_id_connection_id_pk" PRIMARY KEY("workspace_id","connection_id")
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
ALTER TABLE "field_mapping" ADD CONSTRAINT "field_mapping_stitch_id_integration_stitch_id_fk" FOREIGN KEY ("stitch_id") REFERENCES "public"."integration_stitch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_workspace_org_fk" FOREIGN KEY ("workspace_id","org_id") REFERENCES "public"."ui_workspace"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_src_connection_fk" FOREIGN KEY ("src_connection_id") REFERENCES "public"."app_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_dest_connection_fk" FOREIGN KEY ("dest_connection_id") REFERENCES "public"."app_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_outbox" ADD CONSTRAINT "scheduler_outbox_stitch_fk" FOREIGN KEY ("stitch_id") REFERENCES "public"."integration_stitch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_workspace_connection" ADD CONSTRAINT "ui_workspace_connection_workspace_id_ui_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."ui_workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_workspace_connection" ADD CONSTRAINT "ui_workspace_connection_connection_id_app_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."app_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_name_idx" ON "app_connection" USING btree ("app_name");--> statement-breakpoint
CREATE INDEX "tenant_status_idx" ON "app_connection" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "connection_expires_at_idx" ON "app_connection" USING btree ("expires_at") WHERE "app_connection"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_external_id_unique_idx" ON "app_connection" USING btree ("tenant_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_app_display_name_lower_idx" ON "app_connection" USING btree ("tenant_id","app_name",lower("display_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "field_mapping_stitch_canonical_unique_idx" ON "field_mapping" USING btree ("stitch_id","source_canonical");--> statement-breakpoint
CREATE UNIQUE INDEX "stitch_name_workspace_unique_idx" ON "integration_stitch" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "stitch_workspace_idx" ON "integration_stitch" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "stitch_org_idx" ON "integration_stitch" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "stitch_src_conn_idx" ON "integration_stitch" USING btree ("src_connection_id");--> statement-breakpoint
CREATE INDEX "stitch_dest_conn_idx" ON "integration_stitch" USING btree ("dest_connection_id");--> statement-breakpoint
CREATE INDEX "stitch_status_idx" ON "integration_stitch" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "scheduler_outbox_poll_idx" ON "scheduler_outbox" USING btree ("next_retry_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "scheduler_outbox_stitch_idx" ON "scheduler_outbox" USING btree ("stitch_id");--> statement-breakpoint
CREATE INDEX "workspace_connection_conn_idx" ON "ui_workspace_connection" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ui_workspace_org_name_lower_unique_idx" ON "ui_workspace" USING btree ("org_id","env_type",lower("name"));--> statement-breakpoint
CREATE INDEX "ui_workspace_org_idx" ON "ui_workspace" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ui_workspace_env_idx" ON "ui_workspace" USING btree ("org_id","env_type");