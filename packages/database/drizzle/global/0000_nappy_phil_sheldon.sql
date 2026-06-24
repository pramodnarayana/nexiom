CREATE TYPE "public"."organization_status" AS ENUM('active', 'disabled', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."registry_outbox_action_enum" AS ENUM('UPSERT', 'DELETE', 'APPLY');--> statement-breakpoint
CREATE TYPE "public"."registry_outbox_entity_enum" AS ENUM('APP_CONNECTION', 'UI_WORKSPACE', 'INTEGRATION_STITCH', 'FIELD_MAPPING', 'SCHEMA_PROVISION');--> statement-breakpoint
CREATE TYPE "public"."auth_type_enum" AS ENUM('OAUTH2', 'API_KEY', 'BASIC');--> statement-breakpoint
CREATE TYPE "public"."connection_status_enum" AS ENUM('ACTIVE', 'INACTIVE', 'REVOKED', 'EXPIRED', 'PROVISIONING', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."env_type_enum" AS ENUM('PRODUCTION', 'SANDBOX');--> statement-breakpoint
CREATE TYPE "public"."scheduler_outbox_action_enum" AS ENUM('CREATED', 'UPDATED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."scheduler_outbox_status_enum" AS ENUM('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."stitch_status_enum" AS ENUM('ACTIVE', 'INACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "connector_object_profiles" (
	"data_source_id" uuid NOT NULL,
	"object_name" varchar(255) NOT NULL,
	"profile" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_object_profiles_data_source_id_object_name_pk" PRIMARY KEY("data_source_id","object_name")
);
--> statement-breakpoint
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
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "account_user_provider_unique" UNIQUE("userId","providerId"),
	CONSTRAINT "account_provider_account_unique" UNIQUE("providerId","accountId")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"inviterId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"role" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"logo" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" text,
	"status" "organization_status" DEFAULT 'active' NOT NULL,
	"isSystem" boolean DEFAULT false NOT NULL,
	"deletedAt" timestamp with time zone,
	CONSTRAINT "organization_id_not_sentinel" CHECK ("organization"."id" <> '__NULL__')
);
--> statement-breakpoint
CREATE TABLE "permission" (
	"id" text PRIMARY KEY NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"description" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permission_resource_action_unique" UNIQUE("resource","action")
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"isSystem" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"id" text PRIMARY KEY NOT NULL,
	"roleId" text NOT NULL,
	"permissionId" text NOT NULL,
	"organizationId" text,
	"conditions" jsonb
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	"impersonatedBy" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"emailVerified" boolean NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"role" text DEFAULT 'member',
	"banned" boolean,
	"banReason" text,
	"banExpires" timestamp with time zone,
	"deletedAt" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pieces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"categories" jsonb,
	"auth_type" varchar(100),
	"auth_schema" jsonb,
	"aliases" jsonb,
	"logo_url" varchar(1024),
	"package_name" varchar(255) NOT NULL,
	"version" varchar(50) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pieces_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "global_registry_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(255) NOT NULL,
	"entity_type" "registry_outbox_entity_enum" NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" "registry_outbox_action_enum" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_message" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_outbox_status_check" CHECK (status IN ('PENDING', 'RETRY', 'FAIL', 'SUCCESS', 'PROCESSING'))
);
--> statement-breakpoint
CREATE TABLE "shard_registry" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"database_name" varchar(128) NOT NULL,
	"database_host_url" varchar(255) NOT NULL,
	"region_context" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"max_tenants" integer DEFAULT 1000 NOT NULL,
	"current_tenants" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_storage_registry" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"database_name" varchar(128) NOT NULL,
	"database_host_url" varchar(255) NOT NULL,
	"region_context" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
ALTER TABLE "connector_object_profiles" ADD CONSTRAINT "connector_object_profiles_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_role_role_id_fk" FOREIGN KEY ("role") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_user_id_fk" FOREIGN KEY ("inviterId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_role_role_id_fk" FOREIGN KEY ("role") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_roleId_role_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permissionId_permission_id_fk" FOREIGN KEY ("permissionId") REFERENCES "public"."permission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_impersonatedBy_user_id_fk" FOREIGN KEY ("impersonatedBy") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_mapping" ADD CONSTRAINT "field_mapping_stitch_id_integration_stitch_id_fk" FOREIGN KEY ("stitch_id") REFERENCES "public"."integration_stitch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_workspace_org_fk" FOREIGN KEY ("workspace_id","org_id") REFERENCES "public"."ui_workspace"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_source_data_source_fk" FOREIGN KEY ("source_data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_stitch" ADD CONSTRAINT "stitch_dest_data_source_fk" FOREIGN KEY ("dest_data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_outbox" ADD CONSTRAINT "scheduler_outbox_data_source_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cred_data_source_idx" ON "credential" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "cred_status_idx" ON "credential" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cred_expires_at_idx" ON "credential" USING btree ("expires_at") WHERE "credential"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "member_user_org_unique" ON "member" USING btree ("userId","organizationId") WHERE "member"."deletedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "member_org_idx" ON "member" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_unique_idx" ON "organization" USING btree ("slug") WHERE "deletedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_role_permission_org_id" ON "role_permission" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_role_permission_unique" ON "role_permission" USING btree ("roleId","permissionId",COALESCE("organizationId", '__NULL__'));--> statement-breakpoint
CREATE INDEX "registry_outbox_poll_idx" ON "global_registry_outbox" USING btree ("next_retry_at") WHERE status = 'PENDING' OR status = 'RETRY';--> statement-breakpoint
CREATE INDEX "registry_outbox_tenant_idx" ON "global_registry_outbox" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "shard_status_region_idx" ON "shard_registry" USING btree ("status","region_context","current_tenants");--> statement-breakpoint
CREATE INDEX "registry_dbname_idx" ON "tenant_storage_registry" USING btree ("database_name");--> statement-breakpoint
CREATE INDEX "registry_region_idx" ON "tenant_storage_registry" USING btree ("region_context");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_mapping_tenant_idx" ON "canonical_mappings" USING btree ("tenant_id","app_name","category","entity","view_mode","version") WHERE "canonical_mappings"."tenant_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_mapping_global_idx" ON "canonical_mappings" USING btree ("app_name","category","entity","view_mode","version") WHERE "canonical_mappings"."tenant_id" IS NULL;--> statement-breakpoint
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
CREATE INDEX "scheduler_outbox_poll_idx" ON "scheduler_outbox" USING btree ("next_retry_at") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "scheduler_outbox_data_source_idx" ON "scheduler_outbox" USING btree ("data_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ui_ws_org_name_lower_unique_idx" ON "ui_workspace" USING btree ("org_id","env_type",lower("name"));--> statement-breakpoint
CREATE INDEX "ui_ws_org_idx" ON "ui_workspace" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ui_ws_env_idx" ON "ui_workspace" USING btree ("org_id","env_type");