-- Migration: Create connector_object_profiles table.
--
-- Re-keyed from (app_name, object_name) to (connection_id, object_name)
-- because Salesforce-style custom objects (e.g. rtms__Load__c) are org-specific
-- and differ per customer instance. The old global keying would incorrectly
-- share metadata across unrelated orgs using the same app.
--
-- Reversible: DOWN section drops the table entirely (it holds only a
-- soft cache — no business data is lost; MetadataDiscoveryService will
-- repopulate on next request).

-- UP -------------------------------------------------------------------------
CREATE TABLE "connector_object_profiles" (
    "connection_id" uuid NOT NULL,
    "object_name" varchar(255) NOT NULL,
    "profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "connector_object_profiles_pkey" PRIMARY KEY ("connection_id","object_name")
);
--> statement-breakpoint
ALTER TABLE "connector_object_profiles"
    ADD CONSTRAINT "connector_object_profiles_connection_id_app_connection_id_fk"
    FOREIGN KEY ("connection_id")
    REFERENCES "public"."app_connection"("id")
    ON DELETE cascade
    ON UPDATE no action;
--> statement-breakpoint
-- Allows MetadataDiscoveryService to list all cached objects for a connection
CREATE INDEX "cop_connection_idx" ON "connector_object_profiles" USING btree ("connection_id");

-- DOWN -----------------------------------------------------------------------
-- DROP INDEX  "cop_connection_idx";
-- DROP TABLE  "connector_object_profiles";
