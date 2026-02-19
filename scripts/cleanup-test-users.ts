#!/usr/bin/env npx tsx

import { Pool } from 'pg';
import 'dotenv/config';

async function cleanupTestUsers() {
    const connectionString = process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/nexiom_local';
    const pool = new Pool({ connectionString });

    try {
        console.log('🧹 Cleaning up test users...');

        // 1. Delete verification tokens
        await pool.query(`
            DELETE FROM "verification" 
            WHERE identifier LIKE 'auth-test-%'
        `);

        // 2. Delete users matching the test pattern
        // The pattern used in e2e tests is `auth-test-${Date.now()}@example.com`
        // So we look for emails starting with 'auth-test-'
        const result = await pool.query(`
            DELETE FROM "user" 
            WHERE email LIKE 'auth-test-%'
            RETURNING email;
        `);

        if (result.rowCount && result.rowCount > 0) {
            console.log(`✅ Deleted ${result.rowCount} test users:`);
            result.rows.forEach(row => console.log(`   - ${row.email}`));
        } else {
            console.log('✨ No test users found to clean up.');
        }

    } catch (error) {
        console.error('❌ Error cleaning up test users:', error);
    } finally {
        await pool.end();
    }
}

cleanupTestUsers()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
