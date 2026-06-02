DROP INDEX "registry_dbname_unique_idx";--> statement-breakpoint
CREATE INDEX "registry_dbname_idx" ON "tenant_storage_registry" USING btree ("database_name");