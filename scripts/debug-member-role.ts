
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../packages/identity/src/schema'; // Adjust path as needed
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load from apps/api/.env
const envPath = path.resolve(process.cwd(), 'apps/api/.env');
console.log('Loading .env from:', envPath);
dotenv.config({ path: envPath });

const run = async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('DATABASE_URL is missing!');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: dbUrl });
    const db = drizzle(pool, { schema });

    console.log('--- Debugging Member Roles ---');

    // 1. Get all users
    const users = await db.select().from(schema.user);
    console.log(`Found ${users.length} users.`);

    for (const u of users) {
        console.log(`\nUser: ${u.email} (ID: ${u.id})`);
        console.log(`Global Role: ${u.role}`);

        // 2. Get Memberships
        const members = await db.select().from(schema.member).where(eq(schema.member.userId, u.id));
        console.log(`Memberships: ${members.length}`);

        for (const m of members) {
            console.log(`  - Org: ${m.organizationId}`);
            console.log(`    Member Role ID: ${m.roleId}`);

            // Check if role exists
            const r = await db.select().from(schema.role).where(eq(schema.role.id, m.roleId));
            if (r.length) {
                console.log(`    Role Name: ${r[0].name}`);
            } else {
                console.log(`    [WARNING] Role ID '${m.roleId}' not found in role table!`);
            }
        }
    }

    await pool.end();
};

run().catch(console.error);
