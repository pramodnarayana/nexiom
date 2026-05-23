import { Pool } from "pg";
import { config } from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Load environment variables from the monorepo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "../.env") });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("\x1b[31mError: DATABASE_URL is not defined in your environment variables.\x1b[0m");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

const defaultMapping = [
  { src: "$.displayName", dest: "$.DisplayName", required: true },
  { src: "$.displayName", dest: "$.CompanyName", required: true },
  { src: "$.billingCountry", dest: "$.BillAddr.Country" },
  { src: "$.displayName", dest: "$.BillAddr.Line1" },
  { src: "$.billingStreet", dest: "$.BillAddr.Line2" },
  { src: "$.billingCity", dest: "$.BillAddr.City" },
  { src: "$.billingState", dest: "$.BillAddr.CountrySubDivisionCode" },
  { src: "$.billingPostalCode", dest: "$.BillAddr.PostalCode" },
  { src: "$.billingCity", dest: "$.ShipAddr.City" },
  { src: "$.billingState", dest: "$.ShipAddr.CountrySubDivisionCode" },
  { src: "$.billingPostalCode", dest: "$.ShipAddr.PostalCode" },
  { src: "$.phone", dest: "$.PrimaryPhone.FreeFormNumber" },
  { src: "$.fax", dest: "$.Fax.FreeFormNumber" }
];

function toCamel(row) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v
    ])
  );
}

function printUsage() {
  console.log(`
\x1b[1;36mNexiom Stitch & Field Mapping Creator Script\x1b[0m
Creates or updates an integration stitch and its associated field mappings.
Ensures that replication to the tenant database is triggered automatically.

\x1b[1mUsage:\x1b[0m
  node scripts/create-stitch.mjs [options]

\x1b[1mOptions:\x1b[0m
  --name, -n          Name of the stitch (e.g. "Salesforce to QuickBooks")
  --src-conn, -s      Source Connection UUID (required)
  --dest-conn, -d     Destination Connection UUID (required)
  --src-obj, -so      Source Object Name (required, e.g. "Account" or "rtms__Load__c")
  --dest-obj, -do     Destination Object Name (required, e.g. "Customer" or "Invoice")
  --canonical, -c     Source Canonical Type (required, e.g. "TMS_CUSTOMER" or "TMS_CARRIER")
  --rules, -r         Inline JSON string of mapping rules
  --rules-file, -f    Path to a JSON file containing mapping rules
  --interval, -i      Sync interval in minutes (default: 30)
  --workspace, -w     UI Workspace UUID (optional, will auto-resolve if omitted)

\x1b[1mExample:\x1b[0m
  node scripts/create-stitch.mjs \\
    -n "Salesforce to QuickBooks" \\
    -s "0be743ed-63fa-4919-a05f-f5b975df022a" \\
    -d "03ffb2e7-c7ef-476d-b7f6-4b72867bb509" \\
    -so "rtms__Load__c" \\
    -do "Vendor" \\
    -c "TMS_CARRIER" \\
    -f "./mapping.json"
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    name: null,
    srcConn: null,
    destConn: null,
    srcObj: null,
    destObj: null,
    canonical: null,
    rules: null,
    rulesFile: null,
    interval: 30,
    workspace: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--name" || arg === "-n") options.name = args[++i];
    else if (arg === "--src-conn" || arg === "-s") options.srcConn = args[++i];
    else if (arg === "--dest-conn" || arg === "-d") options.destConn = args[++i];
    else if (arg === "--src-obj" || arg === "-so") options.srcObj = args[++i];
    else if (arg === "--dest-obj" || arg === "-do") options.destObj = args[++i];
    else if (arg === "--canonical" || arg === "-c") options.canonical = args[++i];
    else if (arg === "--rules" || arg === "-r") options.rules = args[++i];
    else if (arg === "--rules-file" || arg === "-f") options.rulesFile = args[++i];
    else if (arg === "--interval" || arg === "-i") {
      options.interval = parseInt(args[++i], 10);
      if (isNaN(options.interval) || options.interval <= 0) {
        console.error("\x1b[31mError: --interval must be a positive integer.\x1b[0m");
        process.exit(1);
      }
    }
    else if (arg === "--workspace" || arg === "-w") options.workspace = args[++i];
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return options;
}

async function listConnections() {
  try {
    const res = await pool.query(`
      SELECT d.id, d.app_name, d.display_name, d.tenant_id, c.status, d.env_type 
      FROM public.data_source d
      LEFT JOIN public.credential c ON c.data_source_id = d.id
      ORDER BY d.app_name, d.display_name
    `);
    
    if (res.rows.length === 0) {
      console.log("\n\x1b[33mNo connections found in database.\x1b[0m");
      return;
    }

    console.log("\n\x1b[1;32mAvailable Data Sources in Global Database:\x1b[0m");
    console.table(res.rows.map(r => ({
      ID: r.id,
      App: r.app_name,
      Name: r.display_name,
      TenantID: r.tenant_id,
      Env: r.env_type,
      Status: r.status
    })));
  } catch (err) {
    console.error("Error fetching connections:", err);
  }
}

async function run() {
  const opts = parseArgs();

  // Validate required options
  if (!opts.srcConn || !opts.destConn || !opts.srcObj || !opts.destObj || !opts.canonical) {
    console.error("\x1b[31mError: Missing required parameters.\x1b[0m");
    printUsage();
    await listConnections();
    process.exit(1);
  }

  if (isNaN(opts.interval) || opts.interval <= 0) {
    console.error("\x1b[31mError: --interval must be a positive integer.\x1b[0m");
    process.exit(1);
  }

  // Parse mapping rules
  let mappingRules = defaultMapping;
  if (opts.rulesFile) {
    try {
      const content = fs.readFileSync(path.resolve(process.cwd(), opts.rulesFile), "utf-8");
      mappingRules = JSON.parse(content);
    } catch (err) {
      console.error(`\x1b[31mError reading rules-file ${opts.rulesFile}: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  } else if (opts.rules) {
    try {
      mappingRules = JSON.parse(opts.rules);
    } catch (err) {
      console.error(`\x1b[31mError parsing inline rules: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  }

  try {
    // 1. Validate connections exist and belong to the same tenant (or identify target tenant)
    const { rows: connections } = await pool.query(
      "SELECT * FROM public.data_source WHERE id IN ($1, $2)",
      [opts.srcConn, opts.destConn]
    );

    if (connections.length < 2) {
      const foundIds = connections.map(c => c.id);
      const missing = [opts.srcConn, opts.destConn].filter(id => !foundIds.includes(id));
      console.error(`\x1b[31mError: Connection(s) not found in database: ${missing.join(", ")}\x1b[0m`);
      process.exit(1);
    }

    const srcConn = connections.find(c => c.id === opts.srcConn);
    const destConn = connections.find(c => c.id === opts.destConn);

    // Verify both connections belong to the same tenant to prevent cross-tenant stitches
    if (srcConn.tenant_id !== destConn.tenant_id) {
      console.error(
        `\x1b[31mError: Cross-tenant stitch detected!\x1b[0m\n` +
        `  Source connection ${srcConn.id} belongs to tenant ${srcConn.tenant_id}\n` +
        `  Destination connection ${destConn.id} belongs to tenant ${destConn.tenant_id}\n` +
        `  Both connections must belong to the same tenant.`
      );
      process.exit(1);
    }

    const tenantId = srcConn.tenant_id;
    console.log(`\n\x1b[32m✔ Verified Connections (Tenant ID: ${tenantId})\x1b[0m`);
    console.log(`  Source:      ${srcConn.display_name} (${srcConn.app_name})`);
    console.log(`  Destination: ${destConn.display_name} (${destConn.app_name})`);

    // 2. Resolve Workspace
    let workspaceId = opts.workspace;
    let orgId = tenantId;
    let workspaceRow;

    if (!workspaceId) {
      // Find workspace for this tenant
      const { rows: workspaces } = await pool.query(
        "SELECT * FROM public.ui_workspace WHERE org_id = $1 LIMIT 1",
        [tenantId]
      );

      if (workspaces.length > 0) {
        workspaceRow = workspaces[0];
        workspaceId = workspaceRow.id;
        orgId = workspaceRow.org_id;
        console.log(`\x1b[32m✔ Resolved existing UI Workspace:\x1b[0m ${workspaceRow.name} (${workspaceId})`);
      } else {
        // Create workspace
        const newWs = await pool.query(
          `INSERT INTO public.ui_workspace (name, org_id, env_type) 
           VALUES ($1, $2, 'PRODUCTION') 
           RETURNING *`,
          ["Default Workspace", tenantId]
        );
        workspaceRow = newWs.rows[0];
        workspaceId = workspaceRow.id;
        orgId = workspaceRow.org_id;
        console.log(`\x1b[33m✔ Created Default Workspace:\x1b[0m ${workspaceId}`);
      }
    } else {
      // Verify workspace exists
      const { rows: workspaces } = await pool.query(
        "SELECT * FROM public.ui_workspace WHERE id = $1 AND org_id = $2",
        [workspaceId, tenantId]
      );
      if (workspaces.length === 0) {
        console.error(`\x1b[31mError: Workspace ${workspaceId} not found for organization/tenant ${tenantId}\x1b[0m`);
        process.exit(1);
      }
      workspaceRow = workspaces[0];
      orgId = workspaceRow.org_id;
    }

    // 3-6. Link Connections, Create/Update Stitch, Field Mapping, and Outbox — all in a transaction
    const client = await pool.connect();
    let stitch, mapping;
    try {
      await client.query('BEGIN');

      // 3. Link Data Sources to Workspace
      for (const dsId of [opts.srcConn, opts.destConn]) {
        await client.query(
          `INSERT INTO public.ui_workspace_data_source (workspace_id, data_source_id)
           VALUES ($1, $2)
           ON CONFLICT (workspace_id, data_source_id) DO NOTHING`,
          [workspaceId, dsId]
        );
      }
      console.log(`\x1b[32m✔ Linked connections to Workspace ${workspaceId}\x1b[0m`);

      // 4. Create or Update Integration Stitch
      const stitchName = opts.name || `${srcConn.app_name} to ${destConn.app_name} Sync`;

      // Check for existing stitch
      const { rows: existingStitches } = await client.query(
        `SELECT * FROM public.integration_stitch
         WHERE workspace_id = $1 AND src_data_source_id = $2 AND dest_data_source_id = $3
           AND source_object = $4 AND target_object = $5`,
        [workspaceId, opts.srcConn, opts.destConn, opts.srcObj, opts.destObj]
      );

      if (existingStitches.length > 0) {
        stitch = existingStitches[0];
        const res = await client.query(
          `UPDATE public.integration_stitch
           SET name = $1, sync_interval_minutes = $2, updated_at = NOW()
           WHERE id = $3
           RETURNING *`,
          [stitchName, opts.interval, stitch.id]
        );
        stitch = res.rows[0];
        console.log(`\x1b[32m✔ Updated existing Integration Stitch:\x1b[0m ${stitch.name} (${stitch.id})`);
      } else {
        const res = await client.query(
          `INSERT INTO public.integration_stitch (
            name, org_id, workspace_id, src_data_source_id, dest_data_source_id,
            source_object, target_object, sync_interval_minutes
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [stitchName, orgId, workspaceId, opts.srcConn, opts.destConn, opts.srcObj, opts.destObj, opts.interval]
        );
        stitch = res.rows[0];
        console.log(`\x1b[32m✔ Created new Integration Stitch:\x1b[0m ${stitch.name} (${stitch.id})`);
      }

      // 5. Create or Update Field Mapping
      const { rows: existingMappings } = await client.query(
        "SELECT * FROM public.field_mapping WHERE stitch_id = $1 AND source_canonical = $2",
        [stitch.id, opts.canonical]
      );

      if (existingMappings.length > 0) {
        mapping = existingMappings[0];
        const res = await client.query(
          `UPDATE public.field_mapping
           SET mapping_rules = $1::jsonb, updated_at = NOW()
           WHERE id = $2
           RETURNING *`,
          [JSON.stringify(mappingRules), mapping.id]
        );
        mapping = res.rows[0];
        console.log(`\x1b[32m✔ Updated Field Mapping rules for ${opts.canonical} (${mapping.id})\x1b[0m`);
      } else {
        const res = await client.query(
          `INSERT INTO public.field_mapping (stitch_id, source_canonical, mapping_rules)
           VALUES ($1, $2, $3::jsonb)
           RETURNING *`,
          [stitch.id, opts.canonical, JSON.stringify(mappingRules)]
        );
        mapping = res.rows[0];
        console.log(`\x1b[32m✔ Created Field Mapping rules for ${opts.canonical} (${mapping.id})\x1b[0m`);
      }

      // 6. Push to global_registry_outbox for Tenant DB Replication
      // Order matters: UI_WORKSPACE must arrive before INTEGRATION_STITCH (FK dependency).
      // Each is inserted with a staggered next_retry_at to ensure ordering even under
      // concurrent batch processing by the outbox worker.
      console.log(`\n\x1b[33mReplicating registry configurations to Tenant DB...\x1b[0m`);

      const now = new Date();
      const entries = [
        { entityType: "UI_WORKSPACE",       entityId: workspaceRow.id, payload: toCamel(workspaceRow), delayMs: 0    },
        { entityType: "INTEGRATION_STITCH", entityId: stitch.id,        payload: toCamel(stitch),       delayMs: 1000 },
        { entityType: "FIELD_MAPPING",      entityId: mapping.id,       payload: toCamel(mapping),      delayMs: 2000 },
      ];

      for (const e of entries) {
        const nextRetryAt = new Date(now.getTime() + e.delayMs);
        await client.query(
          `INSERT INTO public.global_registry_outbox (
            id, tenant_id, entity_type, entity_id, action, payload, status, next_retry_at
           ) VALUES (gen_random_uuid(), $1, $2, $3, 'UPSERT', $4::jsonb, 'PENDING', $5)`,
          [tenantId, e.entityType, e.entityId, JSON.stringify(e.payload), nextRetryAt]
        );
        console.log(`  + Queued replication: ${e.entityType} (${e.entityId})${e.delayMs > 0 ? ` [delayed ${e.delayMs}ms]` : ''}`);
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    console.log(`\n\x1b[32m✔ Successfully completed! The changes will replicate to the tenant database within 5 seconds.\x1b[0m\n`);

  } catch (err) {
    console.error("\x1b[31mCritical error during stitch creation:\x1b[0m", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
