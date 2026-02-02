import pg from 'pg';

const { Pool } = pg;

// Use the correct database URL from apps/api/.env
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/nexiom_local';

const pool = new Pool({
    connectionString: DATABASE_URL,
});

async function cleanupUser(email: string) {
    const client = await pool.connect();
    console.log(`\n🧹 Cleaning up user: ${email}`);

    try {
        await client.query('BEGIN');

        // Find user
        const userResult = await client.query(
            'SELECT id, email FROM "user" WHERE email = $1',
            [email]
        );

        if (userResult.rows.length === 0) {
            console.log(`❌ User not found: ${email}`);
            await client.query('ROLLBACK');
            return;
        }

        const userId = userResult.rows[0].id;
        console.log(`✓ Found user: ${userId}`);

        // Delete in correct order to respect foreign key constraints

        // 1. Delete sessions
        const sessionsResult = await client.query(
            'DELETE FROM "session" WHERE "userId" = $1',
            [userId]
        );
        console.log(`✓ Deleted ${sessionsResult.rowCount || 0} sessions`);

        // 2. Delete accounts (social logins)
        const accountsResult = await client.query(
            'DELETE FROM "account" WHERE "userId" = $1',
            [userId]
        );
        console.log(`✓ Deleted ${accountsResult.rowCount || 0} accounts`);

        // 3. Delete verification tokens
        const verificationsResult = await client.query(
            'DELETE FROM "verification" WHERE identifier = $1',
            [email]
        );
        console.log(`✓ Deleted ${verificationsResult.rowCount || 0} verification tokens`);

        // 4. Find memberships to identify organizations
        const membershipsResult = await client.query(
            'SELECT id, "organizationId" FROM "member" WHERE "userId" = $1',
            [userId]
        );
        const memberships = membershipsResult.rows;
        console.log(`✓ Found ${memberships.length} memberships`);

        // 5. Delete invitations sent by this user
        const invitationsByUserResult = await client.query(
            'DELETE FROM "invitation" WHERE "inviterId" = $1',
            [userId]
        );
        console.log(`✓ Deleted ${invitationsByUserResult.rowCount || 0} invitations sent by user`);

        // 6. Delete invitations to this email
        const invitationsToUserResult = await client.query(
            'DELETE FROM "invitation" WHERE email = $1',
            [email]
        );
        console.log(`✓ Deleted ${invitationsToUserResult.rowCount || 0} invitations to user`);

        // 7. Delete memberships
        const deleteMembershipsResult = await client.query(
            'DELETE FROM "member" WHERE "userId" = $1',
            [userId]
        );
        console.log(`✓ Deleted ${deleteMembershipsResult.rowCount || 0} memberships`);

        // 8. Check and delete orphaned organizations
        for (const membership of memberships) {
            if (membership.organizationId) {
                const remainingMembersResult = await client.query(
                    'SELECT COUNT(*) as count FROM "member" WHERE "organizationId" = $1',
                    [membership.organizationId]
                );

                if (parseInt(remainingMembersResult.rows[0].count) === 0) {
                    await client.query(
                        'DELETE FROM "organization" WHERE id = $1',
                        [membership.organizationId]
                    );
                    console.log(`✓ Deleted orphaned organization: ${membership.organizationId}`);
                }
            }
        }

        // 9. Finally, delete the user
        await client.query('DELETE FROM "user" WHERE id = $1', [userId]);
        console.log(`✓ Deleted user: ${userId}`);

        await client.query('COMMIT');
        console.log(`\n✅ Successfully cleaned up user: ${email}`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`\n❌ Error cleaning up user:`, error);
        throw error;
    } finally {
        client.release();
    }
}

// Main execution
const emailToCleanup = process.argv[2] || 'pramod.narayana+tenant1@gmail.com';

cleanupUser(emailToCleanup)
    .then(() => {
        console.log('\n✅ Cleanup complete');
        pool.end();
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Cleanup failed:', error);
        pool.end();
        process.exit(1);
    });
