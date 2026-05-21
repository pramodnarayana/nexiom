/**
 * scripts/migrate-app-profiles.mjs
 *
 * Migrates existing app_connection records to ensure they have the correct
 * appProfile in their metadata JSON payload, required for the new GitOps shard routing.
 *
 * Salesforce -> 'revenova'
 * QuickBooks -> 'online'
 */

import pg from 'pg';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../apps/api/.env'), override: false });
config({ path: resolve(__dirname, '../.env'), override: false });

const GLOBAL_DATABASE_URL = process.env.DATABASE_URL;

if (!GLOBAL_DATABASE_URL) { 
    console.error('DATABASE_URL not set'); 
    process.exit(1); 
}

const client = new pg.Client({ connectionString: GLOBAL_DATABASE_URL });
await client.connect();
console.log(`Connected to global database.`);

try {
    console.log('Migrating Salesforce connections to appProfile "revenova"...');
    const sfResult = await client.query(`
        UPDATE app_connection
        SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"appProfile": "revenova"}'::jsonb
        WHERE app_name = 'salesforce'
          AND (metadata->>'appProfile' IS NULL OR metadata->>'appProfile' = 'default')
    `);
    console.log(`Updated ${sfResult.rowCount} Salesforce connections.`);

    console.log('Migrating QuickBooks connections to appProfile "online"...');
    const qbResult = await client.query(`
        UPDATE app_connection
        SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"appProfile": "online"}'::jsonb
        WHERE app_name = 'quickbooks'
          AND (metadata->>'appProfile' IS NULL OR metadata->>'appProfile' = 'default')
    `);
    console.log(`Updated ${qbResult.rowCount} QuickBooks connections.`);
} catch (err) {
    console.error('Migration failed:', err);
} finally {
    await client.end();
    console.log('Done.');
}
