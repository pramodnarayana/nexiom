CREATE TABLE IF NOT EXISTS "connection_storage_registry" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" varchar(128) NOT NULL,
	"database_host_id" varchar(255) DEFAULT 'primary-cluster' NOT NULL,
	"region_context" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "connection_storage_registry" ADD CONSTRAINT "connection_storage_registry_connection_id_app_connection_id_fk"
    FOREIGN KEY ("connection_id") REFERENCES "public"."app_connection"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
