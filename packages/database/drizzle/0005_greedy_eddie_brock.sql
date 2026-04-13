CREATE TABLE "canonical_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_name" varchar(100) NOT NULL,
	"category" varchar(50) NOT NULL,
	"entity" varchar(100) NOT NULL,
	"view_mode" varchar(50) NOT NULL,
	"tenant_id" varchar(100),
	"version" varchar(50) DEFAULT 'v1' NOT NULL,
	"mapping_config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_mapping_unique_idx" ON "canonical_mappings" USING btree ("app_name","category","entity","view_mode","version");