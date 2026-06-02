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
CREATE INDEX "shard_status_region_idx" ON "shard_registry" USING btree ("status","region_context","current_tenants");
