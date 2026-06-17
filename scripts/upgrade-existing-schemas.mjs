/**
 * upgrade-existing-schemas.mjs
 *
 * Upgrades all existing NAMESPACE_ONLY connection schemas to STANDARD_ACTIVE
 * (L1→L3 pipeline tables), aligning them with the new provisioning contract
 * where L1-L3 is provisioned at connection creation time.
 *
 * All DDL is idempotent — safe to run multiple times.
 */

import pg from 'pg';
import pgFormat from 'pg-format';
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
if (!TENANT_DATABASE_URL) { console.error('TENANT_DATABASE_URL not set'); process.exit(1); }

try {
  const globalUrl = new URL(GLOBAL_DATABASE_URL);
  const tenantUrl = new URL(TENANT_DATABASE_URL);
  if (globalUrl.hostname !== tenantUrl.hostname || globalUrl.port !== tenantUrl.port || globalUrl.pathname !== tenantUrl.pathname) {
    console.error('ERROR: GLOBAL_DATABASE_URL and TENANT_DATABASE_URL must point to the same database (host/port/db). Mismatch detected!');
    process.exit(1);
  }
} catch (e) {
  console.error('Failed to parse database URLs', e);
  process.exit(1);
}

// Connect to the TENANT DB to find connections and provision workspace schemas
const client = new pg.Client({ connectionString: TENANT_DATABASE_URL });
await client.connect();
console.log(`Running against: ${TENANT_DATABASE_URL?.replace(/:[^:@]*@/, ':***@')}`);

const catalogClient = new pg.Client({ connectionString: GLOBAL_DATABASE_URL });
await catalogClient.connect();

// Fetch all connections that need upgrading
const { rows: connections } = await catalogClient.query(
  `SELECT id, app_name, schema_name, schema_plan FROM data_source WHERE schema_plan = ANY($1)`,
  [['NAMESPACE_ONLY']]
);

if (connections.length === 0) {
  console.log('No connections found in this database.');
  await client.end();
  process.exit(0);
}


console.log(`Upgrading ${connections.length} connection schema(s) to STANDARD_ACTIVE...\n`);

// Helper function to safely quote schema-qualified identifiers
function schemaTable(schema, table) {
  return pgFormat('%I.%I', schema, table);
}

for (const conn of connections) {
  const { schema_name: schemaName, app_name: appName, id, schema_plan: currentPlan } = conn;
  console.log(`  → ${schemaName} (${appName}, was: ${currentPlan})`);

  try {
    // 1. Ensure schema exists
    await client.query(pgFormat('CREATE SCHEMA IF NOT EXISTS %I', schemaName));

    // 1.5. Rename connection_id to data_source_id idempotently for existing schemas
    for (const table of ['inbound_gateway', 'inbound_outbox', 'active_sync_locks', 'replica_entity', 'sync_cursor', 'replica_outbox', 'normalized_outbox']) {
      await client.query(pgFormat(
        `DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = %L
               AND table_name   = %L
               AND column_name  = 'connection_id'
          ) THEN
            EXECUTE 'ALTER TABLE %I.%I RENAME COLUMN connection_id TO data_source_id';
          END IF;
        END $$;`,
        schemaName, table, schemaName, table
      ));
    }

    // 2. L1 — inbound_gateway
    await client.query(pgFormat(`
      CREATE TABLE IF NOT EXISTS %I.inbound_gateway (`, schemaName) + `
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
    await client.query(pgFormat(`CREATE UNIQUE INDEX IF NOT EXISTS idx_l1_ext_id ON %I.inbound_gateway (data_source_id, ext_req_id) WHERE ext_req_id IS NOT NULL`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_l1_status ON %I.inbound_gateway (status)`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_l1_request_gin ON %I.inbound_gateway USING gin (request)`, schemaName));
    await client.query(pgFormat(`ALTER TABLE %I.inbound_gateway ADD COLUMN IF NOT EXISTS response JSONB`, schemaName));

    // 2.5. L1 — sync_log (Moved from L4 to L1)
    await client.query(pgFormat(`
      CREATE TABLE IF NOT EXISTS %I.sync_log (`, schemaName) + `
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id    UUID        NOT NULL,
        route_id    UUID,
        layer       TEXT        NOT NULL CHECK (layer IN ('L1','L2','L3','L4','L5','L6')),
        status      TEXT        NOT NULL CHECK (status IN ('RECEIVED','PROCESSING','REPLICATED','NORMALIZED','SKIPPED','PENDING','SUCCESS','FAIL','RETRY','DISMISSED')),
        duration_ms INTEGER,
        timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(pgFormat(`
      DO $$ DECLARE constraint_name TEXT; BEGIN
        SELECT conname INTO constraint_name FROM pg_constraint WHERE conrelid = %L::regclass AND contype = 'u' AND conname NOT IN ('uq_sync_log_routed', 'uq_sync_log_unrouted') LIMIT 1;
        IF constraint_name IS NOT NULL THEN EXECUTE 'ALTER TABLE %I.sync_log DROP CONSTRAINT IF EXISTS ' || quote_ident(constraint_name); END IF;
      END $$;
    `, schemaTable(schemaName, 'sync_log'), schemaName));
    await client.query(pgFormat(`CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_log_routed ON %I.sync_log (trace_id, route_id, layer, status) WHERE route_id IS NOT NULL`, schemaName));
    await client.query(pgFormat(`CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_log_unrouted ON %I.sync_log (trace_id, layer, status) WHERE route_id IS NULL`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_log_trace ON %I.sync_log (trace_id)`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_log_route ON %I.sync_log (route_id)`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_log_trace_layer ON %I.sync_log (trace_id, layer)`, schemaName));

    // 3. L1 — inbound_outbox
    await client.query(pgFormat(`
      CREATE TABLE IF NOT EXISTS %I.inbound_outbox (`, schemaName) + `
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
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_inbound_outbox_claim ON %I.inbound_outbox (status, next_retry_at ASC) WHERE status IN ('PENDING', 'PROCESSING', 'RETRY')`, schemaName));
    await client.query(pgFormat(`DO $$ BEGIN ALTER TABLE %I.inbound_outbox ADD CONSTRAINT idx_inbound_outbox_trace UNIQUE (trace_id, data_source_id); EXCEPTION WHEN others THEN NULL; END $$`, schemaName));

    // 4. L1 — active_sync_locks
    await client.query(pgFormat(`
      CREATE TABLE IF NOT EXISTS %I.active_sync_locks (`, schemaName) + `
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
    await client.query(pgFormat(`
      CREATE TABLE IF NOT EXISTS %I.replica_entity (`, schemaName) + `
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
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_l2_trace ON %I.replica_entity (trace_id)`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_l2_data_gin ON %I.replica_entity USING gin (data)`, schemaName));

    await client.query(pgFormat(`
      CREATE TABLE IF NOT EXISTS %I.sync_cursor (`, schemaName) + `
        id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        data_source_id       UUID         NOT NULL,
        entity_type         VARCHAR(100) NOT NULL,
        last_sync_timestamp VARCHAR(255) NOT NULL,
        updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_cursor UNIQUE (data_source_id, entity_type)
      )
    `);

    await client.query(pgFormat(`
      CREATE TABLE IF NOT EXISTS %I.replica_outbox (`, schemaName) + `
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
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_replica_outbox_claim ON %I.replica_outbox (status, next_retry_at ASC) WHERE status IN ('PENDING', 'PROCESSING', 'RETRY')`, schemaName));
    await client.query(pgFormat(`DO $$ BEGIN ALTER TABLE %I.replica_outbox ADD CONSTRAINT idx_replica_outbox_trace UNIQUE (trace_id, data_source_id); EXCEPTION WHEN others THEN NULL; END $$`, schemaName));

    // 6. L3 — normalized_entity + normalized_outbox
    await client.query(pgFormat(`
      CREATE TABLE IF NOT EXISTS %I.normalized_entity (`, schemaName) + `
        id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id       UUID         NOT NULL,
        replica_id     UUID         NOT NULL,
        canonical_type VARCHAR(100) NOT NULL,
        data           JSONB        NOT NULL,
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_l3_replica UNIQUE (replica_id)
      )
    `);
    await client.query(pgFormat(`ALTER TABLE %I.normalized_entity ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_l3_trace ON %I.normalized_entity (trace_id)`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_l3_canonical ON %I.normalized_entity (canonical_type)`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_l3_data_gin ON %I.normalized_entity USING gin (data)`, schemaName));

    await client.query(pgFormat(`
      CREATE TABLE IF NOT EXISTS %I.normalized_outbox (`, schemaName) + `
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
    await client.query(pgFormat(`DO $$ BEGIN ALTER TABLE %I.normalized_outbox ADD COLUMN IF NOT EXISTS schema_name VARCHAR(128) NOT NULL DEFAULT current_schema(); EXCEPTION WHEN others THEN NULL; END $$`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_normalized_outbox_claim ON %I.normalized_outbox (status, next_retry_at ASC) WHERE status IN ('PENDING', 'PROCESSING', 'RETRY')`, schemaName));
    await client.query(pgFormat(`DO $$ BEGIN ALTER TABLE %I.normalized_outbox ADD CONSTRAINT idx_normalized_outbox_trace UNIQUE (trace_id, data_source_id); EXCEPTION WHEN others THEN NULL; END $$`, schemaName));

    // 7. L6 — global_entity_map (GEM — belongs in tenant schema)
    await client.query(pgFormat(`
      CREATE TABLE IF NOT EXISTS %I.global_entity_map (`, schemaName) + `
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
    await client.query(pgFormat(`CREATE UNIQUE INDEX IF NOT EXISTS gem_unique_mapping_idx ON %I.global_entity_map (stitch_id, source_app_id, source_entity_id, dest_app_id, dest_entity_type)`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS gem_src_lookup_idx ON %I.global_entity_map (source_entity_id, source_app_id)`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS gem_dest_lookup_idx ON %I.global_entity_map (dest_entity_id, dest_app_id)`, schemaName));

    // 7.5 L5 — outbound_gateway + outbound_outbox
    await client.query(pgFormat(`
      CREATE TABLE IF NOT EXISTS %I.outbound_gateway (`, schemaName) + `
        id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id       UUID        NOT NULL,
        route_id       UUID        NOT NULL,
        data_source_id  UUID        NOT NULL,
        src_data_source_id UUID        NOT NULL,
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
    await client.query(pgFormat(`DO $$ BEGIN ALTER TABLE %I.outbound_gateway ADD COLUMN IF NOT EXISTS src_data_source_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'; EXCEPTION WHEN others THEN NULL; END $$`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_l5_trace ON %I.outbound_gateway (trace_id)`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_l5_route ON %I.outbound_gateway (route_id)`, schemaName));
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_l5_status ON %I.outbound_gateway (status)`, schemaName));

    await client.query(pgFormat(`
      CREATE TABLE IF NOT EXISTS %I.outbound_outbox (`, schemaName) + `
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
    await client.query(pgFormat(`CREATE INDEX IF NOT EXISTS idx_outbound_outbox_claim ON %I.outbound_outbox (status, next_retry_at ASC) WHERE status IN ('PENDING','PROCESSING','RETRY')`, schemaName));

    // 8. Update schemaPlan in data_source
    await catalogClient.query(
      `UPDATE data_source SET schema_plan = 'STANDARD_ACTIVE' WHERE id = $1`,
      [id]
    );

    console.log(`    ✓ Provisioned ${schemaName} to STANDARD_ACTIVE`);
  } catch (err) {
    console.error(`    ✗ Failed: ${err.message}`);
  }
}

await client.end();
await catalogClient.end();
console.log('\nDone.');
