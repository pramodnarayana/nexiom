/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-floating-promises */
import { Pool } from 'pg';

async function run() {
  console.log('🔄 Starting End-to-End Ingestion Trace Test...');

  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      'postgres://postgres:postgres@localhost:5432/nexiom_local',
  });

  try {
    // Find a Salesforce connection with Revenova profile
    const res = await pool.query(`
            SELECT id, workspace_id, app_name, metadata 
            FROM app_connection 
            WHERE app_name = 'salesforce' AND status = 'ACTIVE'
            LIMIT 1
        `);

    if (res.rows.length === 0) {
      console.log('❌ No active Salesforce connections found to test.');
      return;
    }

    const conn = res.rows[0];
    console.log(
      `✅ Using Connection ID: ${conn.id} (Workspace: ${conn.workspace_id})`,
    );

    // Ensure Revenova profile is set
    if (!conn.metadata || conn.metadata.appProfile !== 'revenova') {
      console.log(
        '⚠️ Warning: Connection metadata missing "appProfile: revenova". Updating it for the test...',
      );
      const newMetadata = { ...conn.metadata, appProfile: 'revenova' };
      await pool.query(
        `UPDATE app_connection SET metadata = $1 WHERE id = $2`,
        [JSON.stringify(newMetadata), conn.id],
      );
      console.log('✅ Metadata updated.');
    }

    const payload = {
      Account: {
        Id: '0015Y00002bcdefGHI',
        Name: 'E2E Test Trucking LLC',
        Type: 'Carrier',
        CurrencyIsoCode: 'USD',
      },
    };

    console.log('🚀 Sending mock webhook payload (L1)...');
    const webhookUrl = `http://localhost:3000/v1/webhooks/${conn.id}`;

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload), // Activepieces parses this inside trigger
    });

    if (!response.ok) {
      console.error(
        '❌ Webhook ingestion failed:',
        response.status,
        await response.text(),
      );
      return;
    }

    console.log(
      '✅ Webhook ingested successfully (L1 Complete)! Row stored in inbound_gateway and inbound_outbox.',
    );
    console.log(
      '⏳ Waiting 5 seconds for InboundOutboxService to sweep and ReplicaService (L2) + NormalizerService (L3) to process...',
    );

    await new Promise((r) => setTimeout(r, 5000));

    // Let's check the database schema
    // We need to resolve schema name. Nexiom uses lowercase connection ID without hyphens
    const schemaName =
      'ws_' + conn.workspace_id.replace(/-/g, '').toLowerCase();

    console.log(`🔍 Inspecting Tenant Schema: ${schemaName}`);

    const resultL2 = await pool.query(
      `SELECT * FROM ${schemaName}.replica_entity ORDER BY updated_at DESC LIMIT 1`,
    );
    if (resultL2.rows.length > 0) {
      console.log('✅ Found Replica (L2):', resultL2.rows[0].data);
    } else {
      console.log('❌ No Replica (L2) found.');
    }

    const resultL3 = await pool.query(
      `SELECT * FROM ${schemaName}.normalized_entity ORDER BY updated_at DESC LIMIT 1`,
    );
    if (resultL3.rows.length > 0) {
      console.log(
        `✅ Found Normalized Entity (L3) [Type: ${resultL3.rows[0].canonical_type}]:`,
        resultL3.rows[0].data,
      );
    } else {
      console.log('❌ No Normalized Entity (L3) found.');
    }
  } catch (err) {
    console.error('Fatal Error:', err);
  } finally {
    await pool.end();
  }
}

run();
