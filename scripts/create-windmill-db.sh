#!/bin/bash
# Creates the windmill database inside the existing postgres instance.
# Runs once on first container start via /docker-entrypoint-initdb.d/.
# Idempotent: the SELECT ... WHERE NOT EXISTS pattern skips creation if the DB
# already exists, so re-running postgres with existing data is safe.
set -e

# Configurable tenant database name with fallback
TENANT_DB_NAME="${TENANT_DB_NAME:-nexiom_tenant_9d8efd73_3cf1_4e71_b4b0_a47dc08e1a53}"

psql -v ON_ERROR_STOP=1 -v tenant_db="$TENANT_DB_NAME" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE windmill'
    WHERE NOT EXISTS (
        SELECT FROM pg_database WHERE datname = 'windmill'
    )\gexec

    SELECT 'CREATE DATABASE nexiom_global'
    WHERE NOT EXISTS (
        SELECT FROM pg_database WHERE datname = 'nexiom_global'
    )\gexec

    SELECT format('CREATE DATABASE %I', :'tenant_db')
    WHERE NOT EXISTS (
        SELECT FROM pg_database WHERE datname = :'tenant_db'
    )\gexec
EOSQL
