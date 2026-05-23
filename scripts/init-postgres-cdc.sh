#!/bin/bash
set -euo pipefail

echo "[init-postgres-cdc] Setting up logical replication for Debezium..."

# The default max_replication_slots is 10 in PG15, but we set it to 5 in docker-compose.
# Create the replication slot using pgoutput (standard logical replication output plugin).
# Provide idempotent creation:
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = 'nexiom_slot') THEN
      PERFORM pg_create_logical_replication_slot('nexiom_slot', 'pgoutput');
      RAISE NOTICE 'Created logical replication slot: nexiom_slot';
    ELSE
      RAISE NOTICE 'Logical replication slot nexiom_slot already exists.';
    END IF;
  END
  \$\$;

  -- Create a publication that covers all tables in the public schema by default.
  -- Tenant-specific schemas (e.g. ws_sf_abc123) are added dynamically via the TriggerExecutorService
  -- when their connection properties are provisioned.
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'nexiom_cdc') THEN
      CREATE PUBLICATION nexiom_cdc FOR TABLES IN SCHEMA public;
      RAISE NOTICE 'Created publication: nexiom_cdc';
    ELSE
      RAISE NOTICE 'Publication nexiom_cdc already exists.';
    END IF;
  END
  \$\$;
EOSQL

echo "[init-postgres-cdc] Done."
