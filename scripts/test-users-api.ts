
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../packages/identity/src/schema';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { DrizzleUserAdapter } from '../packages/identity/src/adapters/drizzle-user.adapter';

// Load from apps/api/.env
const envPath = path.resolve(process.cwd(), 'apps/api/.env');
dotenv.config({ path: envPath });

const run = async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) process.exit(1);

    const pool = new Pool({ connectionString: dbUrl });
    const db = drizzle(pool, { schema });

    // Mock AuthProvider (not needed for findAll)
    const mockAuthProvider = {} as any;

    const adapter = new DrizzleUserAdapter(db, mockAuthProvider);

    console.log('--- Testing findAll for Tenant1 ---');

    // Org ID for tenant1 from previous debug script: 02b8e986-81d0-4a8d-b2db-ad29e93999d3
    const tenantId = '02b8e986-81d0-4a8d-b2db-ad29e93999d3';

    const result = await adapter.findAll({ tenantId });

    console.log('Found users:', result.total);
    result.data.forEach(u => {
        console.log(`User: ${u.email}`);
        console.log(`Global Role: ${u.role}`);
        console.log(`Member Role: ${u.memberRole}`);
        console.log('---');
    });

    await pool.end();
};

run().catch(console.error);
