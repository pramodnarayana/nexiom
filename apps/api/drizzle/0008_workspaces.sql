DO $$ BEGIN
  CREATE TYPE "public"."env_type_enum" AS ENUM('PRODUCTION', 'SANDBOX');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ui_workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"env_type" "env_type_enum" DEFAULT 'PRODUCTION' NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ui_workspace_connection" (
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"assigned_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "ui_workspace_connection_pkey" PRIMARY KEY ("workspace_id","connection_id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ui_workspace" ADD CONSTRAINT "ui_workspace_org_id_organization_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ui_workspace_connection" ADD CONSTRAINT "ui_workspace_connection_workspace_id_ui_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."ui_workspace"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ui_workspace_connection" ADD CONSTRAINT "ui_workspace_connection_connection_id_app_connection_id_fk"
    FOREIGN KEY ("connection_id") REFERENCES "public"."app_connection"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- Case-insensitive uniqueness per env — same name allowed in PRODUCTION vs SANDBOX
CREATE UNIQUE INDEX IF NOT EXISTS "ui_workspace_org_name_lower_unique_idx" ON "ui_workspace" USING btree ("org_id", "env_type", lower("name"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ui_workspace_id_org_unique_idx" ON "ui_workspace" USING btree ("id","org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ui_workspace_org_idx" ON "ui_workspace" USING btree ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ui_workspace_env_idx" ON "ui_workspace" USING btree ("org_id","env_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_connection_conn_idx" ON "ui_workspace_connection" USING btree ("connection_id");
