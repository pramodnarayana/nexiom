
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../packages/identity/src/schema';
import { eq, and } from 'drizzle-orm';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

// Load from apps/api/.env
const envPath = path.resolve(process.cwd(), 'apps/api/.env');
dotenv.config({ path: envPath });

const run = async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) process.exit(1);

    const pool = new Pool({ connectionString: dbUrl });
    const db = drizzle(pool, { schema });

    console.log('--- Fixing Orphaned Users ---');

    const users = await db.select().from(schema.user);

    for (const u of users) {
        // Check memberships
        const members = await db.select().from(schema.member).where(eq(schema.member.userId, u.id));

        if (members.length === 0) {
            console.log(`\nFound Orphaned User: ${u.email} (${u.name || 'No Name'})`);

            // 1. Create Organization
            const orgName = u.name ? `${u.name}'s Organization` : `Organization for ${u.email.split('@')[0]}`;
            const orgId = uuidv4();
            console.log(`  > Creating Org: ${orgName}`);

            await db.insert(schema.organization).values({
                id: orgId,
                name: orgName,
                slug: uuidv4(), // Temporary slug
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date()
            });

            // 2. Add Member as Admin
            console.log(`  > Assigning 'admin' role...`);
            await db.insert(schema.member).values({
                id: uuidv4(),
                userId: u.id,
                organizationId: orgId,
                roleId: 'admin', // Ensure this matches the ID in 'role' table
                createdAt: new Date()
            });

            console.log(`  > [DONE] User is now Admin of their new/default org.`);
        }
    }

    if (users.length === 0) console.log('No users found.');

    await pool.end();
};

run().catch(console.error);
