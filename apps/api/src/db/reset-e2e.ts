import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from apps/api root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not defined in environment');
    process.exit(1);
  }

  // Production safeguard
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.DATABASE_URL.includes('prod') ||
    process.env.DATABASE_URL.includes('rds.amazonaws.com')
  ) {
    if (process.env.FORCE_RESET !== 'true') {
      console.error(
        'FATAL: Attempting to run reset-e2e against production database!',
      );
      console.error('This operation would destroy all production data.');
      console.error('If you absolutely must proceed, set FORCE_RESET=true');
      process.exit(1);
    }
    console.warn(
      'WARNING: FORCE_RESET=true detected, proceeding with production reset...',
    );
  }

  console.log('Connecting to DB...');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    console.log('--- 1. Truncating Tables ---');
    const tables = [
      'role_permission',
      'permission',
      'member',
      'invitation',
      'account',
      'session',
      'verification',
      'organization',
      'user',
      'role',
    ];

    for (const table of tables) {
      try {
        await client.query(`TRUNCATE TABLE "${table}" CASCADE;`);
      } catch (e) {
        console.error(`Error truncating table "${table}":`, e);
        console.log(`Skipped ${table} - check permissions or table existence`);
      }
    }

    console.log('--- 2. Seeding RBAC ---');
    // Roles
    await client.query(`
            INSERT INTO "role" (id, name, "isSystem", description, "createdAt") VALUES
            ('owner', 'Owner', true, 'Full access', NOW()),
            ('admin', 'Admin', true, 'Manage users', NOW()),
            ('member', 'Member', true, 'Read only', NOW()),
            ('platform_admin', 'Platform Admin', true, 'System Root Access', NOW())
            ON CONFLICT DO NOTHING;
        `);

    // Permissions
    const perms = [
      'users:read',
      'users:create',
      'users:update',
      'users:delete',
      'users:manage',
      'tenants:read',
      'tenants:create',
      'tenants:update',
      'tenants:delete',
      'tenants:manage',
      'dashboard:read',
      'admin_dashboard:view', // Required for Redirect to /admin
      'settings:manage',
      'settings:read',
      // System Admin Permissions
      'system_users:read',
      'system_users:manage',
      'system_users:invite',
      'system_tenants:read',
      'system_tenants:manage',
    ];

    for (const p of perms) {
      const resource = p.split(':')[0];
      const action = p.split(':')[1];
      await client.query(
        `
                INSERT INTO "permission" (id, resource, action, "createdAt")
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT DO NOTHING;
            `,
        [p, resource, action],
      );
    }

    // Role Permissions
    // Owner & Platform Admin: All
    for (const p of perms) {
      await client.query(
        `INSERT INTO "role_permission" ("roleId", "permissionId") VALUES ('owner', $1) ON CONFLICT DO NOTHING`,
        [p],
      );
      await client.query(
        `INSERT INTO "role_permission" ("roleId", "permissionId") VALUES ('platform_admin', $1) ON CONFLICT DO NOTHING`,
        [p],
      );
    }

    // Member: Read
    await client.query(
      `INSERT INTO "role_permission" ("roleId", "permissionId") VALUES ('member', 'users:read') ON CONFLICT DO NOTHING`,
    );
    await client.query(
      `INSERT INTO "role_permission" ("roleId", "permissionId") VALUES ('member', 'tenants:read') ON CONFLICT DO NOTHING`,
    );

    console.log('--- 3. Seeding User ---');
    const userId = uuidv4();
    const email = 'pramod.narayana@example.com';

    await client.query(
      `
            INSERT INTO "user" (id, email, "emailVerified", name, "createdAt", "updatedAt")
            VALUES ($1, $2, true, 'Pramod Narayana', NOW(), NOW());
        `,
      [userId, email],
    );

    console.log('--- 4. Seeding Account (Password) ---');
    const passwordStart = 'password123';
    const hash = await bcrypt.hash(passwordStart, 10);
    const accountId = uuidv4();

    await client.query(
      `
            INSERT INTO "account" (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, 'credential', $4, NOW(), NOW());
        `,
      [accountId, userId, email, hash],
    );

    console.log('--- 5. Seeding Organizations ---');

    // 5a. System Tenant (Nexiom)
    const systemTenantId = '00000000-0000-0000-0000-000000000000';
    await client.query(
      `
            INSERT INTO "organization" (id, name, status, "isSystem", "createdAt", "updatedAt")
            VALUES ($1, 'Nexiom Platform', 'active', true, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING;
        `,
      [systemTenantId],
    );

    // 5b. Demo Customer Tenant
    const demoTenantId = uuidv4();
    await client.query(
      `
            INSERT INTO "organization" (id, name, status, "createdAt", "updatedAt")
            VALUES ($1, 'Acme Corp', 'active', NOW(), NOW());
        `,
      [demoTenantId],
    );

    console.log('--- 6. Seeding Membership ---');

    // 6a. Platform Admin Access (System Context)
    const sysMemberId = uuidv4();
    // Note: platform_admin role already seeded in step 2 (roles: owner, admin, member, platform_admin)

    await client.query(
      `
            INSERT INTO "member" (id, "organizationId", "userId", "roleId", "createdAt")
            VALUES ($1, $2, $3, 'platform_admin', NOW());
        `,
      [sysMemberId, systemTenantId, userId],
    );

    // 6b. Customer Tenant Access (Business Context)
    // STRICT: One User One Org. Pramod is Platform Admin ONLY.
    // We create a separate user for the customer tenant.
    const customerUserId = uuidv4();
    const customerEmail = 'customer@acme.com';

    await client.query(
      `
            INSERT INTO "user" (id, email, "emailVerified", name, "createdAt", "updatedAt")
            VALUES ($1, $2, true, 'Acme Customer', NOW(), NOW());
        `,
      [customerUserId, customerEmail],
    );

    const customerHash = await bcrypt.hash('password123', 10);
    await client.query(
      `
            INSERT INTO "account" (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, 'credential', $4, NOW(), NOW());
        `,
      [uuidv4(), customerUserId, customerEmail, customerHash],
    );

    const memberId = uuidv4();
    await client.query(
      `
            INSERT INTO "member" (id, "organizationId", "userId", "roleId", "createdAt")
            VALUES ($1, $2, $3, 'owner', NOW());
        `,
      [memberId, demoTenantId, customerUserId],
    );

    console.log('✅ SEED COMPLETE');
    console.log(
      `[Platform Admin] ${email} / ${passwordStart} (Org: Nexiom Platform)`,
    );
    console.log(
      `[Customer User]  ${customerEmail} / password123 (Org: Acme Corp)`,
    );
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
};

void main();
