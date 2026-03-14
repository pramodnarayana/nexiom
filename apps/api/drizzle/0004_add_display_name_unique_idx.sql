-- Migration: Add unique index enforcing case-insensitive display name uniqueness per tenant+provider.
-- Prevents two connections to the same app from sharing the same display name (ignoring case).
CREATE UNIQUE INDEX "tenant_app_display_name_lower_idx" ON "app_connection" USING btree ("tenant_id", "app_name", lower("display_name"));
