import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

export class DbFixture {
    private pool: Pool;

    constructor() {
        // DB connection string from docker-compose or environment
        // Assuming default local dev credentials
        const connectionString = process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/nexiom_local';

        this.pool = new Pool({
            connectionString,
        });
    }

    async close() {
        await this.pool.end();
    }

    /**
     * Checks if a user's email is marked as verified in the database.
     */
    async isEmailVerified(email: string): Promise<boolean> {
        const query = `
            SELECT "emailVerified" 
            FROM "user" 
            WHERE email = $1
        `;
        const result = await this.pool.query(query, [email]);

        if (result.rows.length === 0) {
            throw new Error(`[DB] User not found: ${email}`);
        }

        return result.rows[0].emailVerified;
    }

    /**
     * Verify user exists
     */
    async userExists(email: string): Promise<boolean> {
        const query = 'SELECT 1 FROM "user" WHERE email = $1';
        const result = await this.pool.query(query, [email]);
        return result.rowCount ? result.rowCount > 0 : false;
    }

    /**
     * Promotes a user to System Owner (Super Admin)
     */
    async makeSystemAdmin(email: string) {
        // IDs from apps/api/src/constants.ts / admin-bootstrap.ts
        const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
        const OWNER_ROLE_ID = 'owner';
        console.log(`[DB] Promoting user to System Admin: ${email}`);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            // 1. Get User ID
            const userRes = await client.query('SELECT id FROM "user" WHERE email = $1', [email]);
            if (userRes.rows.length === 0) throw new Error(`User not found: ${email}`);
            const userId = userRes.rows[0].id;
            // 2. Check if System Tenant exists (create if not)
            await client.query(`
                INSERT INTO "organization" (id, name, slug, status, "isSystem")
                VALUES ($1, 'Nexiom Platform', 'system', 'active', true)
                ON CONFLICT (id) DO NOTHING
            `, [SYSTEM_TENANT_ID]);
            // 3. Ensure Owner Role exists
            await client.query(`
                INSERT INTO "role" (id, name, "isSystem", description)
                VALUES ($1, 'Owner', true, 'Full access')
                ON CONFLICT (id) DO NOTHING
            `, [OWNER_ROLE_ID]);
            // 4. Enforce Single Tenant Policy: Remove existing memberships
            // The app is strict single-tenant, and signup likely created a default tenant/member.
            await client.query('DELETE FROM "member" WHERE "userId" = $1', [userId]);
            // 5. Insert Member Record
            const memberId = randomUUID();
            await client.query(`
                INSERT INTO "member" (id, "userId", "organizationId", role)
                VALUES ($1, $2, $3, $4)
            `, [memberId, userId, SYSTEM_TENANT_ID, OWNER_ROLE_ID]);
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    /**
     * Hard delete a user for cleanup
     */
    async cleanupUser(email: string) {
        console.log(`[DB] Cleaning up user: ${email}`);

        // 1. Delete verification tokens (No FK cascade)
        await this.pool.query('DELETE FROM "verification" WHERE identifier = $1', [email]);

        // 2. Delete user (Cascades to session, account, member, invitation)
        await this.pool.query('DELETE FROM "user" WHERE email = $1', [email]);

        // Note: This leaves orphaned Organizations if the user was the sole member.
        // For strict E2E, we might want to clean those too, but it requires more complex logic
        // (checking member counts) which is skipped here for safety.
    }
}
