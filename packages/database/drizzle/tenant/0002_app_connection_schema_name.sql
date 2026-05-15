-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Add schema_name to app_connection
--
-- schema_name is the physical PostgreSQL schema namespace for a connection's
-- tenant workspace. It is computed deterministically as:
--   ws_{provider}_{sha256(connection_id)[0:16]}
-- and is immutable once set at connection-creation time.
--
-- This column becomes the single source of truth for schema resolution,
-- eliminating the need to re-derive the name on every pipeline read.
-- ─────────────────────────────────────────────────────────────────────────────

--> statement-breakpoint
ALTER TABLE "app_connection" ADD COLUMN IF NOT EXISTS "schema_name" varchar(100);

--> statement-breakpoint
-- Backfill existing rows using the canonical algorithm.
-- The expression mirrors getWorkspaceSchemaName(id, appName):
--   1. Strip non-alphanumeric chars from app_name (lowercase)
--   2. Append first 16 hex chars of SHA-256(id::text)
UPDATE "app_connection"
SET "schema_name" = 'ws_'
    || regexp_replace(lower("app_name"), '[^a-z0-9]', '', 'g')
    || '_'
    || substring(encode(sha256("id"::text::bytea), 'hex') FROM 1 FOR 16)
WHERE "schema_name" IS NULL;

--> statement-breakpoint
-- Unique index: two connections can never share a schema namespace.
CREATE UNIQUE INDEX IF NOT EXISTS "app_connection_schema_name_idx"
    ON "app_connection" ("schema_name")
    WHERE "schema_name" IS NOT NULL;
