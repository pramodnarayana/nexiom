CREATE TYPE "public"."auth_type_enum" AS ENUM('OAUTH2', 'API_KEY', 'BASIC');--> statement-breakpoint
CREATE TABLE "provider" (
	"name" varchar(100) PRIMARY KEY NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"auth_type" "auth_type_enum" NOT NULL,
	"authorize_url" text,
	"token_url" text,
	"scopes" jsonb DEFAULT '[]'::jsonb,
	"ui_schema" jsonb DEFAULT '{}'::jsonb,
	"description" text,
	"logo_url" varchar(255),
	"category" varchar(100),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"app_name" varchar(100) NOT NULL,
	"auth_type" varchar(50) NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"expires_at" timestamp with time zone,
	"status" varchar(50) DEFAULT 'ACTIVE' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"connection_key" varchar(255) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "app_name_idx" ON "app_connection" USING btree ("app_name");--> statement-breakpoint
CREATE INDEX "status_idx" ON "app_connection" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_app_connection_unique_idx" ON "app_connection" USING btree ("tenant_id","app_name","connection_key");