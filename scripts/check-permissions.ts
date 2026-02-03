
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../packages/identity/src/schema';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { seedRbac } from '../packages/identity/src/scripts/seed-rbac';

// Load from apps/api/.env which we confirmed exists
const envPath = path.resolve(process.cwd(), 'apps/api/.env');
console.log('Loading .env from:', envPath);
dotenv.config({ path: envPath });

const run = async () => {
    const dbUrl = process.env.DATABASE_URL;
    console.log('DB URL Length:', dbUrl ? dbUrl.length : 'undefined');
    if (!dbUrl) {
        console.error('DATABASE_URL is missing!');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: dbUrl,
    });
    const db = drizzle(pool, { schema });

    console.log('Checking Permissions...');

    // Check specific link
    const roles = await db.select().from(schema.role);
    const links = await db.select().from(schema.rolePermission);
    const perms = await db.select().from(schema.permission);

    const adminRole = roles.find(r => r.id === 'admin');
    let missing = true;

    if (adminRole) {
        const adminLinks = links.filter(l => l.roleId === 'admin');
        const permissionIds = adminLinks.map(l => l.permissionId);
        const adminPerms = perms.filter(p => permissionIds.includes(p.id));

        const hasRead = adminPerms.find(p => p.id === 'users:read');
        if (hasRead) {
            console.log('\n[OK] admin role has users:read.');
            missing = false;
        } else {
            console.error('\n[CRITICAL] admin role MISSING users:read permission!');
        }
    } else {
        console.error('[CRITICAL] admin role NOT FOUND');
    }

    if (missing) {
        console.log('\n>>> ATTEMPTING TO FIX PERMISSIONS (SEEDING) <<<');
        await seedRbac(db);
        console.log('>>> FIX COMPLETE <<<');
    } else {
        console.log('\nPermissions look correct. No action taken.');
    }

    // Double check
    const newLinks = await db.select().from(schema.rolePermission);
    const newAdminLinks = newLinks.filter(l => l.roleId === 'admin');
    console.log(`Admin now has ${newAdminLinks.length} permission links.`);

    await pool.end();
};

run().catch(console.error);
