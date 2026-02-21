CREATE TYPE "public"."auth_type_enum" AS ENUM('OAUTH2', 'API_KEY', 'BASIC');--> statement-breakpoint
CREATE TYPE "public"."connection_status_enum" AS ENUM('ACTIVE', 'INACTIVE', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "provider" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_name_unique" UNIQUE("name"),
	CONSTRAINT "oauth_check" CHECK (auth_type != 'OAUTH2' OR (authorize_url IS NOT NULL AND token_url IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"app_name" varchar(100) NOT NULL,
	"auth_type" "auth_type_enum" NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"expires_at" timestamp with time zone,
	"status" "connection_status_enum" DEFAULT 'ACTIVE' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"connection_key" varchar(255) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "app_name_idx" ON "app_connection" USING btree ("app_name");--> statement-breakpoint
CREATE INDEX "tenant_status_idx" ON "app_connection" USING btree ("tenant_id", "status");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_app_connection_unique_idx" ON "app_connection" USING btree ("tenant_id","app_name","connection_key");--> statement-breakpoint
ALTER TABLE "app_connection" ADD CONSTRAINT "fk_app_connection_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "app_connection" ADD CONSTRAINT "fk_app_connection_provider_id" FOREIGN KEY ("provider_id") REFERENCES "provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;