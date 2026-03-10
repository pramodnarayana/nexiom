CREATE TABLE "connection_storage_registry" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" varchar(128) NOT NULL,
	"database_host_id" varchar(255) DEFAULT 'primary-cluster' NOT NULL,
	"region_context" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "connection_storage_registry" (connection_id, workspace_id, database_host_id, region_context, created_at, updated_at)
SELECT id, workspace_id, 'primary-cluster', 'unknown', now(), now()
FROM "public"."app_connection"
WHERE id NOT IN (SELECT connection_id FROM "connection_storage_registry")
ON CONFLICT (connection_id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE "connection_storage_registry" ADD CONSTRAINT "connection_storage_registry_connection_id_app_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."app_connection"("id") ON DELETE cascade ON UPDATE no action;