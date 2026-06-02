#!/bin/bash
set -euo pipefail

echo "[init-postgres-cdc] Setting up logical replication for Debezium on platform_shard_1..."

# Ensure platform_shard_1 exists before creating CDC artifacts on it
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  SELECT 'CREATE DATABASE platform_shard_1'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'platform_shard_1')\\gexec
EOSQL

# Create the replication slot and publication on platform_shard_1
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "platform_shard_1" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = 'platform_slot') THEN
      PERFORM pg_create_logical_replication_slot('platform_slot', 'pgoutput');
      RAISE NOTICE 'Created logical replication slot: platform_slot on platform_shard_1';
    ELSE
      RAISE NOTICE 'Logical replication slot platform_slot already exists on platform_shard_1.';
    END IF;
  END
  \$\$;

  -- Create a publication that covers all tables in the public schema by default.
  -- Tenant-specific schemas (e.g. ws_sf_abc123) are added dynamically via the TriggerExecutorService
  -- when their connection properties are provisioned.
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'platform_cdc') THEN
      CREATE PUBLICATION platform_cdc FOR TABLES IN SCHEMA public;
      RAISE NOTICE 'Created publication: platform_cdc on platform_shard_1';
    ELSE
      RAISE NOTICE 'Publication platform_cdc already exists on platform_shard_1.';
    END IF;
  END
  \$\$;
EOSQL

echo "[init-postgres-cdc] Done."
