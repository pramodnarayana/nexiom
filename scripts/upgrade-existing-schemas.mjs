/**
 * upgrade-existing-schemas.mjs
 *
 * Upgrades all existing NAMESPACE_ONLY connection schemas to NORMALIZE_ACTIVE
 * (L1→L3 pipeline tables), aligning them with the new provisioning contract
 * where L1-L3 is provisioned at connection creation time.
 *
 * All DDL is idempotent — safe to run multiple times.
 */

import pg from 'pg';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../apps/api/.env'), override: false });
config({ path: resolve(__dirname, '../.env'), override: false });

// Support both global DB (for connections list) and tenant DB (for schema provisioning)
// Run as: TENANT_DATABASE_URL=<tenant-db-url> node scripts/upgrade-existing-schemas.mjs
const GLOBAL_DATABASE_URL = process.env.DATABASE_URL;
const TENANT_DATABASE_URL = process.env.TENANT_DATABASE_URL || GLOBAL_DATABASE_URL;

if (!GLOBAL_DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

// Connect to the TENANT DB to find connections and provision workspace schemas
const client = new pg.Client({ connectionString: TENANT_DATABASE_URL });
await client.connect();
console.log(`Running against: ${TENANT_DATABASE_URL?.replace(/:[^:@]*@/, ':***@')}`);

// Fetch all connections that need upgrading
const { rows: connections } = await client.query(
  `SELECT id, app_name, schema_name, schema_plan FROM data_source`
);

if (connections.length === 0) {
  console.log('No connections found in this database.');
  await client.end();
  process.exit(0);
}


console.log(`Upgrading ${connections.length} connection schema(s) to NORMALIZE_ACTIVE...\n`);

for (const conn of connections) {
  const { schema_name: schemaName, app_name: appName, id, schema_plan: currentPlan } = conn;
  console.log(`  → ${schemaName} (${appName}, was: ${currentPlan})`);

  try {
    // 1. Ensure schema exists
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);

    // 1.5. Rename connection_id to data_source_id idempotently for existing schemas
    for (const table of ['inbound_gateway', 'inbound_outbox', 'active_sync_locks', 'replica_entity', 'sync_cursor', 'replica_outbox', 'normalized_outbox']) {
      await client.query(`
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = '${schemaName}'
               AND table_name   = '${table}'
               AND column_name  = 'connection_id'
          ) THEN
            EXECUTE 'ALTER TABLE "' || '${schemaName}' || '"."' || '${table}' || '" RENAME COLUMN connection_id TO data_source_id';
          END IF;
        END $$;
      `);
    }

    // 2. L1 — inbound_gateway
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".inbound_gateway (
        id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id      UUID         NOT NULL UNIQUE,
        data_source_id UUID         NOT NULL,
        object_type   VARCHAR(100),
        request       JSONB        NOT NULL,
        response      JSONB,
        headers       JSONB,
        ext_req_id    VARCHAR(255),
        status        TEXT         NOT NULL DEFAULT 'RECEIVED'
                      CHECK (status IN ('RECEIVED','PROCESSING','REPLICATED','NORMALIZED','SKIPPED','PENDING','SUCCESS','FAIL','RETRY','DISMISSED')),
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_l1_ext_id ON "${schemaName}".inbound_gateway (data_source_id, ext_req_id) WHERE ext_req_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_l1_status ON "${schemaName}".inbound_gateway (status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_l1_request_gin ON "${schemaName}".inbound_gateway USING gin (request)`);
    await client.query(`ALTER TABLE "${schemaName}".inbound_gateway ADD COLUMN IF NOT EXISTS response JSONB`);

    // 2.5. L1 — sync_log (Moved from L4 to L1)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".sync_log (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id    UUID        NOT NULL,
        route_id    UUID,
        layer       TEXT        NOT NULL CHECK (layer IN ('L1','L2','L3','L4','L5','L6')),
        status      TEXT        NOT NULL CHECK (status IN ('RECEIVED','PROCESSING','REPLICATED','NORMALIZED','SKIPPED','PENDING','SUCCESS','FAIL','RETRY','DISMISSED')),
        duration_ms INTEGER,
        timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      DO $$ DECLARE constraint_name TEXT; BEGIN
        SELECT conname INTO constraint_name FROM pg_constraint WHERE conrelid = '"${schemaName}".sync_log'::regclass AND contype = 'u' AND conname NOT IN ('uq_sync_log_routed', 'uq_sync_log_unrouted') LIMIT 1;
        IF constraint_name IS NOT NULL THEN EXECUTE 'ALTER TABLE "${schemaName}".sync_log DROP CONSTRAINT IF EXISTS ' || quote_ident(constraint_name); END IF;
      END $$;
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_log_routed ON "${schemaName}".sync_log (trace_id, route_id, layer, status) WHERE route_id IS NOT NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_log_unrouted ON "${schemaName}".sync_log (trace_id, layer, status) WHERE route_id IS NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_log_trace ON "${schemaName}".sync_log (trace_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_log_route ON "${schemaName}".sync_log (route_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_log_trace_layer ON "${schemaName}".sync_log (trace_id, layer)`);

    // 3. L1 — inbound_outbox
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".inbound_outbox (
        id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id      UUID         NOT NULL,
        data_source_id UUID         NOT NULL,
        schema_name   VARCHAR(128) NOT NULL DEFAULT current_schema(),
        status        TEXT         NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','PROCESSING','SUCCESS','FAIL','RETRY')),
        attempts      INTEGER      NOT NULL DEFAULT 0,
        last_error    VARCHAR(500),
        next_retry_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inbound_outbox_claim ON "${schemaName}".inbound_outbox (status, next_retry_at ASC) WHERE status IN ('PENDING', 'PROCESSING', 'RETRY')`);
    await client.query(`DO $$ BEGIN ALTER TABLE "${schemaName}".inbound_outbox ADD CONSTRAINT idx_inbound_outbox_trace UNIQUE (trace_id, data_source_id); EXCEPTION WHEN others THEN NULL; END $$`);

    // 4. L1 — active_sync_locks
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".active_sync_locks (
        id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        data_source_id      UUID         NOT NULL,
        entity_id          VARCHAR(255) NOT NULL,
        locked_by_trace_id UUID         NOT NULL,
        expires_at         TIMESTAMPTZ  NOT NULL,
        created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_sync_lock UNIQUE (data_source_id, entity_id)
      )
    `);

    // 5. L2 — replica_entity + sync_cursor + replica_outbox
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".replica_entity (
        id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        data_source_id UUID         NOT NULL,
        trace_id      UUID         NOT NULL,
        entity_id     VARCHAR(255) NOT NULL,
        entity_type   VARCHAR(100) NOT NULL,
        data          JSONB        NOT NULL,
        version       INTEGER      NOT NULL DEFAULT 1,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_l2_entity UNIQUE (data_source_id, entity_type, entity_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_l2_trace ON "${schemaName}".replica_entity (trace_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_l2_data_gin ON "${schemaName}".replica_entity USING gin (data)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".sync_cursor (
        id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        data_source_id       UUID         NOT NULL,
        entity_type         VARCHAR(100) NOT NULL,
        last_sync_timestamp VARCHAR(255) NOT NULL,
        updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_cursor UNIQUE (data_source_id, entity_type)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".replica_outbox (
        id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id      UUID         NOT NULL,
        data_source_id UUID         NOT NULL,
        schema_name   VARCHAR(128) NOT NULL DEFAULT current_schema(),
        status        TEXT         NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','PROCESSING','SUCCESS','FAIL','RETRY')),
        attempts      INTEGER      NOT NULL DEFAULT 0,
        last_error    VARCHAR(500),
        next_retry_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_replica_outbox_claim ON "${schemaName}".replica_outbox (status, next_retry_at ASC) WHERE status IN ('PENDING', 'PROCESSING', 'RETRY')`);
    await client.query(`DO $$ BEGIN ALTER TABLE "${schemaName}".replica_outbox ADD CONSTRAINT idx_replica_outbox_trace UNIQUE (trace_id, data_source_id); EXCEPTION WHEN others THEN NULL; END $$`);

    // 6. L3 — normalized_entity + normalized_outbox
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".normalized_entity (
        id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id       UUID         NOT NULL,
        replica_id     UUID         NOT NULL,
        canonical_type VARCHAR(100) NOT NULL,
        data           JSONB        NOT NULL,
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_l3_replica UNIQUE (replica_id)
      )
    `);
    await client.query(`ALTER TABLE "${schemaName}".normalized_entity ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_l3_trace ON "${schemaName}".normalized_entity (trace_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_l3_canonical ON "${schemaName}".normalized_entity (canonical_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_l3_data_gin ON "${schemaName}".normalized_entity USING gin (data)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".normalized_outbox (
        id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id      UUID         NOT NULL,
        data_source_id UUID         NOT NULL,
        schema_name   VARCHAR(128) NOT NULL DEFAULT current_schema(),
        status        TEXT         NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','PROCESSING','SUCCESS','FAIL','RETRY')),
        attempts      INTEGER      NOT NULL DEFAULT 0,
        last_error    VARCHAR(500),
        next_retry_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`DO $$ BEGIN ALTER TABLE "${schemaName}".normalized_outbox ADD COLUMN IF NOT EXISTS schema_name VARCHAR(128) NOT NULL DEFAULT current_schema(); EXCEPTION WHEN others THEN NULL; END $$`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_normalized_outbox_claim ON "${schemaName}".normalized_outbox (status, next_retry_at ASC) WHERE status IN ('PENDING', 'PROCESSING', 'RETRY')`);
    await client.query(`DO $$ BEGIN ALTER TABLE "${schemaName}".normalized_outbox ADD CONSTRAINT idx_normalized_outbox_trace UNIQUE (trace_id, data_source_id); EXCEPTION WHEN others THEN NULL; END $$`);

    // 7. L6 — global_entity_map (GEM — belongs in tenant schema)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".global_entity_map (
        id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        stitch_id           UUID         NOT NULL,
        source_app_name     VARCHAR(100) NOT NULL,
        source_app_id       UUID         NOT NULL,
        source_org_id       VARCHAR(255) NOT NULL,
        source_org_name     VARCHAR(255),
        source_entity_type  VARCHAR(100) NOT NULL,
        source_entity_id    VARCHAR(255) NOT NULL,
        source_ref_layer    VARCHAR(10)  NOT NULL,
        source_trace_id     UUID         NOT NULL,
        dest_app_name       VARCHAR(100) NOT NULL,
        dest_app_id         UUID         NOT NULL,
        dest_org_id         VARCHAR(255) NOT NULL,
        dest_org_name       VARCHAR(255),
        dest_entity_type    VARCHAR(100) NOT NULL,
        dest_entity_id      VARCHAR(255) NOT NULL,
        dest_ref_layer      VARCHAR(10)  NOT NULL,
        dest_trace_id       UUID         NOT NULL,
        last_synced_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS gem_unique_mapping_idx ON "${schemaName}".global_entity_map (stitch_id, source_app_id, source_entity_id, dest_app_id, dest_entity_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS gem_src_lookup_idx ON "${schemaName}".global_entity_map (source_entity_id, source_app_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS gem_dest_lookup_idx ON "${schemaName}".global_entity_map (dest_entity_id, dest_app_id)`);

    // 7.5 L5 — outbound_gateway + outbound_outbox
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".outbound_gateway (
        id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id       UUID        NOT NULL,
        route_id       UUID        NOT NULL,
        data_source_id  UUID        NOT NULL,
        payload        JSONB       NOT NULL,
        response       JSONB,
        status_code    INTEGER,
        status         TEXT        NOT NULL DEFAULT 'PENDING'
                       CONSTRAINT ck_outbound_status CHECK (status IN ('PENDING','SUCCESS','FAIL','RETRY','PROCESSING','DISMISSED')),
        attempts       INTEGER     NOT NULL DEFAULT 0,
        last_error     TEXT,
        next_retry_at  TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_outbound_trace_route UNIQUE (trace_id, route_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_l5_trace ON "${schemaName}".outbound_gateway (trace_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_l5_route ON "${schemaName}".outbound_gateway (route_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_l5_status ON "${schemaName}".outbound_gateway (status)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".outbound_outbox (
        id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id       UUID        NOT NULL,
        route_id       UUID        NOT NULL,
        data_source_id  UUID        NOT NULL,
        status         TEXT        NOT NULL DEFAULT 'PENDING'
                       CONSTRAINT ck_outbound_outbox_status CHECK (status IN ('PENDING','PROCESSING','SUCCESS','FAIL','RETRY')),
        attempts       INTEGER     NOT NULL DEFAULT 0,
        last_error     TEXT,
        next_retry_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_outbound_outbox_trace UNIQUE (trace_id, route_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_outbound_outbox_claim ON "${schemaName}".outbound_outbox (status, next_retry_at ASC) WHERE status IN ('PENDING','PROCESSING','RETRY')`);

    // 8. Update schemaPlan in data_source
    await client.query(
      `UPDATE data_source SET schema_plan = 'OUTBOUND_ACTIVE' WHERE id = $1`,
      [id]
    );

    console.log(`    ✓ Provisioned ${schemaName} to NORMALIZE_ACTIVE`);
  } catch (err) {
    console.error(`    ✗ Failed: ${err.message}`);
  }
}

await client.end();
console.log('\nDone.');
