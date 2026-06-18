ALTER TABLE "data_source" RENAME COLUMN "vendor_tenant_id" TO "organization_id";--> statement-breakpoint
DROP INDEX "ds_tenant_vendor_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "ds_tenant_organization_id_idx" ON "data_source" USING btree ("tenant_id","app_name","env_type","organization_id");