import { Pool } from 'pg';
import { getWorkspaceSchemaName } from '@soopa/dbmanager';

interface ConnectionRow {
  id: string;
  workspace_id: string;
  app_name: string;
  metadata: Record<string, any> | null;
}

async function run() {
  console.log('🔄 Starting End-to-End Ingestion Trace Test...');

  // Production safety guard
  if (
    process.env.NODE_ENV === 'production' &&
    !process.argv.includes('--yes')
  ) {
    console.error(
      '❌ This script modifies database state and cannot run in production without explicit confirmation.',
    );
    console.error(
      '   To proceed anyway, pass --yes flag: npm run test:e2e-ingestion -- --yes',
    );
    process.exit(1);
  }

  const databaseUrl =
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/platform_local';

  // Sanitize DATABASE_URL for logging
  let sanitizedUrl = databaseUrl;
  try {
    const url = new URL(databaseUrl);
    if (url.username) url.username = 'REDACTED';
    if (url.password) url.password = 'REDACTED';
    sanitizedUrl = url.toString();
  } catch {
    // If parsing fails, just redact the entire URL
    sanitizedUrl = '[REDACTED]';
  }
  console.log(`⚠️  Target Database: ${sanitizedUrl}`);

  if (!process.argv.includes('--yes')) {
    console.log(
      '⚠️  This script will UPDATE app_connection metadata and send test webhooks.',
    );
    console.log('   Pass --yes to skip this warning.');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
  });

  try {
    // Find any active connection for testing
    const res = await pool.query(`
            SELECT id, workspace_id, app_name, metadata
            FROM app_connection
            WHERE status = 'ACTIVE'
            AND app_name = 'salesforce'
            ORDER BY id ASC
            LIMIT 1
        `);

    if (res.rows.length === 0) {
      console.log('❌ No active connections found to test.');
      return;
    }

    const conn = res.rows[0] as ConnectionRow;
    console.log(
      `✅ Using Connection ID: ${conn.id} (Workspace: ${conn.workspace_id})`,
    );

    // Ensure test profile is set if needed by the specific piece
    if (!conn.metadata || !conn.metadata.appProfile) {
      console.log(
        '⚠️ Warning: Connection metadata missing "appProfile". Setting a default test profile...',
      );
      const newMetadata = { ...conn.metadata, appProfile: 'standard' };
      await pool.query(
        `UPDATE app_connection SET metadata = $1 WHERE id = $2`,
        [JSON.stringify(newMetadata), conn.id],
      );
      console.log('✅ Metadata updated.');
    }

    // Generate a unique test run marker
    const testRunId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const runStart = new Date();

    const payload = {
      Account: {
        Id: '0015Y00002bcdefGHI',
        Name: 'E2E Test Trucking LLC',
        Type: 'Carrier',
        CurrencyIsoCode: 'USD',
        __testRunId: testRunId, // Unique marker for this test run
      },
    };

    console.log(
      `🚀 Sending mock webhook payload (L1) with testRunId=${testRunId}...`,
    );
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
      process.exit(1);
    }

    console.log(
      '✅ Webhook ingested successfully (L1 Complete)! Row stored in inbound_gateway and inbound_outbox.',
    );
    console.log('⏳ Polling for pipeline completion (L2/L3)...');

    // Let's check the database schema
    const schemaName = getWorkspaceSchemaName(conn.id, conn.app_name);

    console.log(`🔍 Inspecting Tenant Schema: ${schemaName}`);

    // Poll for pipeline completion instead of fixed sleep
    const POLL_INTERVAL_MS = 500;
    const TIMEOUT_MS = 30000;
    const startTime = Date.now();

    let resultL2;
    let resultL3;

    while (Date.now() - startTime < TIMEOUT_MS) {
      resultL2 = await pool.query(
        `SELECT * FROM ${schemaName}.replica_entity WHERE updated_at >= $1 AND (data->>'__testRunId' = $2 OR data->>'Id' = '0015Y00002bcdefGHI') ORDER BY updated_at DESC LIMIT 1`,
        [runStart, testRunId],
      );
      resultL3 = await pool.query(
        `SELECT * FROM ${schemaName}.normalized_entity WHERE updated_at >= $1 ORDER BY updated_at DESC LIMIT 1`,
        [runStart],
      );

      if (resultL2.rows.length > 0 && resultL3.rows.length > 0) {
        console.log(`✅ Pipeline completed in ${Date.now() - startTime}ms`);
        break;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (Date.now() - startTime >= TIMEOUT_MS) {
      console.error('❌ Timeout: Pipeline did not complete within 30 seconds');
      process.exit(1);
    }

    if (resultL2 && resultL2.rows.length > 0) {
      const row = resultL2.rows[0] as { data: unknown };
      console.log('✅ Found Replica (L2):', row.data);
    } else {
      console.log('❌ No Replica (L2) found.');
    }

    if (resultL3 && resultL3.rows.length > 0) {
      const row = resultL3.rows[0] as { canonical_type: string; data: unknown };
      console.log(
        `✅ Found Normalized Entity (L3) [Type: ${row.canonical_type}]:`,
        row.data,
      );
    } else {
      console.log('❌ No Normalized Entity (L3) found.');
    }
  } catch (err) {
    console.error('❌ Fatal Error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Unhandled execution error:', err);
  process.exit(1);
});
