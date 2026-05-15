import { Pool } from "pg";

const pool = new Pool({ connectionString: "postgres://user:password@localhost:5433/nexiom_global" });

const STITCH_ID = "45375f51-0a16-4df7-9228-161e80fc9fc7";
const SRC_CONN_ID = "0be743ed-63fa-4919-a05f-f5b975df022a";
const DEST_CONN_ID = "03ffb2e7-c7ef-476d-b7f6-4b72867bb509";
const TENANT_ID = "cac9d014-e710-4be9-a060-87f8fae08956";

function toCamel(row) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v
    ])
  );
}

async function main() {
  const { rows: [stitch] } = await pool.query("SELECT * FROM integration_stitch WHERE id=$1", [STITCH_ID]);
  const { rows: conns } = await pool.query("SELECT * FROM app_connection WHERE id = ANY($1)", [[SRC_CONN_ID, DEST_CONN_ID]]);
  const { rows: fms } = await pool.query("SELECT * FROM field_mapping WHERE stitch_id=$1", [STITCH_ID]);

  const entries = [
    ...conns.map(c => ({ entityType: "APP_CONNECTION", entityId: c.id, payload: toCamel(c) })),
    { entityType: "INTEGRATION_STITCH", entityId: stitch.id, payload: toCamel(stitch) },
    ...fms.map(fm => ({ entityType: "FIELD_MAPPING", entityId: fm.id, payload: toCamel(fm) })),
  ];

  for (const e of entries) {
    await pool.query(
      "INSERT INTO global_registry_outbox (id, tenant_id, entity_type, entity_id, action, payload, status) VALUES (gen_random_uuid(), $1, $2, $3, 'UPSERT', $4::jsonb, 'PENDING')",
      [TENANT_ID, e.entityType, e.entityId, JSON.stringify(e.payload)]
    );
    console.log(` + ${e.entityType} ${e.entityId}`);
  }

  console.log(`Done. ${entries.length} entries seeded with camelCase payloads.`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
