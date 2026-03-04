CREATE TYPE "public"."auth_type_enum" AS ENUM('OAUTH2', 'API_KEY', 'BASIC');--> statement-breakpoint
CREATE TYPE "public"."connection_status_enum" AS ENUM('ACTIVE', 'INACTIVE', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "connector_object_profiles" (
	"app_name" varchar(100) NOT NULL,
	"object_name" varchar(100) NOT NULL,
	"profile" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "connector_object_profiles_app_name_object_name_pk" PRIMARY KEY("app_name","object_name")
);
--> statement-breakpoint
CREATE TABLE "connection_storage_registry" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" varchar(128) NOT NULL,
	"database_host_id" varchar(255) DEFAULT 'primary-cluster' NOT NULL,
	"region_context" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_storage_registry_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "app_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"app_name" varchar(100) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"auth_type" "auth_type_enum" NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone,
	"status" "connection_status_enum" DEFAULT 'ACTIVE' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connection_storage_registry" ADD CONSTRAINT "connection_storage_registry_connection_id_app_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."app_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_name_idx" ON "app_connection" USING btree ("app_name");--> statement-breakpoint
CREATE INDEX "tenant_status_idx" ON "app_connection" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_external_id_unique_idx" ON "app_connection" USING btree ("tenant_id","external_id");