-- Adds env_type to app_connection so that sandbox connections can only be assigned
-- to sandbox workspaces and production connections to production workspaces.
-- The env_type_enum type was created in 0008_workspaces.sql.

ALTER TABLE "app_connection" ADD COLUMN "env_type" "env_type_enum" NOT NULL DEFAULT 'PRODUCTION';
