-- Migration: Add DISMISSED value to pipeline_status_enum
--
-- PostgreSQL allows adding new values to an existing enum type without
-- a table rewrite. The new value is immediately available to all tenant
-- schemas that reference pipeline_status_enum (since the type is shared).
--
-- Note: ALTER TYPE ADD VALUE cannot run inside a transaction in PG < 12.
-- As of PG 14+ it can run in a transaction but the new value is only visible
-- after the transaction commits. We isolate it here with no surrounding
-- transaction in drizzle-kit's non-transactional migration mode.

ALTER TYPE "pipeline_status_enum" ADD VALUE IF NOT EXISTS 'DISMISSED';
