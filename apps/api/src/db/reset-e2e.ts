import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

// Load .env from apps/api root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const loadEnv = () => {
  const {
    DATABASE_URL,
    SYSTEM_TENANT_ID,
    OWNER_ROLE_ID,
    ADMIN_ROLE_ID,
    MEMBER_ROLE_ID,
  } = process.env;

  if (
    !DATABASE_URL ||
    !SYSTEM_TENANT_ID ||
    !OWNER_ROLE_ID ||
    !ADMIN_ROLE_ID ||
    !MEMBER_ROLE_ID
  ) {
    console.error('FATAL: Missing required environment variables.');
    process.exit(1);
  }

  return {
    DATABASE_URL,
    SYSTEM_TENANT_ID,
    OWNER_ROLE_ID,
    ADMIN_ROLE_ID,
    MEMBER_ROLE_ID,
  };
};

const validateEnv = (dbUrl: string) => {
  if (
    process.env.NODE_ENV === 'production' ||
    dbUrl.includes('prod') ||
    dbUrl.includes('rds.amazonaws.com')
  ) {
    if (process.env.FORCE_RESET !== 'true') {
      console.error(
        'FATAL: Attempting to run reset-e2e against production database!',
      );
      process.exit(1);
    }
    console.warn(
      'WARNING: FORCE_RESET=true detected, proceeding with production reset...',
    );
  }
};

const truncateTables = async (client: Client) => {
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
    }
  }
};

const seedRBAC = async (
  client: Client,
  ids: { owner: string; admin: string; member: string; systemTenant: string },
) => {
  console.log('--- 3. Seeding RBAC ---');
  await client.query(
    `INSERT INTO "role" (id, name, "isSystem", description, "createdAt") VALUES
        ($1, 'Owner', true, 'Full access', NOW()),
        ($2, 'Admin', true, 'Manage users', NOW()),
        ($3, 'Member', true, 'Read only', NOW())
        ON CONFLICT DO NOTHING;`,
    [ids.owner, ids.admin, ids.member],
  );

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
    'admin_dashboard:view',
    'settings:manage',
    'settings:read',
    'system_users:read',
    'system_users:manage',
    'system_users:invite',
    'system_tenants:read',
    'system_tenants:manage',
  ];

  for (const p of perms) {
    const [resource, action] = p.split(':');
    await client.query(
      `INSERT INTO "permission" (id, resource, action, "createdAt") VALUES ($1, $2, $3, NOW()) ON CONFLICT (id) DO NOTHING;`,
      [p, resource, action],
    );
  }

  // Assign Permissions
  // Member (Read Only)
  await client.query(
    `INSERT INTO "role_permission" ("roleId", "permissionId", "organizationId") VALUES ($1, 'users:read', NULL) ON CONFLICT DO NOTHING`,
    [ids.member],
  );
  await client.query(
    `INSERT INTO "role_permission" ("roleId", "permissionId", "organizationId") VALUES ($1, 'tenants:read', NULL) ON CONFLICT DO NOTHING`,
    [ids.member],
  );

  for (const p of perms) {
    if (!p.startsWith('system_')) {
      // Admin (Global)
      await client.query(
        `INSERT INTO "role_permission" ("roleId", "permissionId", "organizationId") VALUES ($1, $2, NULL) ON CONFLICT DO NOTHING`,
        [ids.admin, p],
      );
      // Owner (Global) - except dashboard override
      if (p !== 'admin_dashboard:view') {
        await client.query(
          `INSERT INTO "role_permission" ("roleId", "permissionId", "organizationId") VALUES ($1, $2, NULL) ON CONFLICT DO NOTHING`,
          [ids.owner, p],
        );
      }
    } else {
      // System Permissions for Owner (Scoped)
      await client.query(
        `INSERT INTO "role_permission" ("roleId", "permissionId", "organizationId") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [ids.owner, p, ids.systemTenant],
      );
    }
  }

  // Add back admin_dashboard:view for Owner in System Tenant
  await client.query(
    `INSERT INTO "role_permission" ("roleId", "permissionId", "organizationId") VALUES ($1, 'admin_dashboard:view', $2) ON CONFLICT DO NOTHING`,
    [ids.owner, ids.systemTenant],
  );
};

const seedUsersAndTenants = async (
  client: Client,
  ids: {
    systemTenant: string;
    owner: string;
  },
) => {
  console.log('--- 2. Seeding Organizations ---');
  await client.query(
    `INSERT INTO "organization" (id, name, status, "isSystem", "createdAt", "updatedAt") VALUES ($1, 'Nexiom Platform', 'active', true, NOW(), NOW()) ON CONFLICT (id) DO NOTHING;`,
    [ids.systemTenant],
  );

  const demoTenantId = uuidv4();
  await client.query(
    `INSERT INTO "organization" (id, name, status, "createdAt", "updatedAt") VALUES ($1, 'Acme Corp', 'active', NOW(), NOW());`,
    [demoTenantId],
  );

  console.log('--- 4. Seeding User ---');
  const userId = uuidv4();
  const email = 'test.user+e2e@example.com';
  await client.query(
    `INSERT INTO "user" (id, email, "emailVerified", name, "createdAt", "updatedAt") VALUES ($1, $2, true, 'Test User', NOW(), NOW());`,
    [userId, email],
  );

  const hash = await bcrypt.hash('password123', 10);
  await client.query(
    `INSERT INTO "account" (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, 'credential', $4, NOW(), NOW());`,
    [uuidv4(), userId, email, hash],
  );

  // System Membership
  await client.query(
    `INSERT INTO "member" (id, "organizationId", "userId", "roleId", "createdAt") VALUES ($1, $2, $3, $4, NOW());`,
    [uuidv4(), ids.systemTenant, userId, ids.owner],
  );

  console.log('--- 5. Seeding Customer User ---');
  const customerUserId = uuidv4();
  const customerEmail = 'customer@example.com';
  await client.query(
    `INSERT INTO "user" (id, email, "emailVerified", name, "createdAt", "updatedAt") VALUES ($1, $2, true, 'Acme Customer', NOW(), NOW());`,
    [customerUserId, customerEmail],
  );
  await client.query(
    `INSERT INTO "account" (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, 'credential', $4, NOW(), NOW());`,
    [uuidv4(), customerUserId, customerEmail, hash],
  );
  await client.query(
    `INSERT INTO "member" (id, "organizationId", "userId", "roleId", "createdAt") VALUES ($1, $2, $3, $4, NOW());`,
    [uuidv4(), demoTenantId, customerUserId, ids.owner],
  );

  console.log('✅ SEED COMPLETE');
};

const main = async () => {
  const env = loadEnv();
  validateEnv(env.DATABASE_URL);

  console.log('Connecting to DB...');
  const client = new Client({ connectionString: env.DATABASE_URL });

  try {
    await client.connect();
    await truncateTables(client);
    await seedRBAC(client, {
      owner: env.OWNER_ROLE_ID,
      admin: env.ADMIN_ROLE_ID,
      member: env.MEMBER_ROLE_ID,
      systemTenant: env.SYSTEM_TENANT_ID,
    });
    await seedUsersAndTenants(client, {
      systemTenant: env.SYSTEM_TENANT_ID,
      owner: env.OWNER_ROLE_ID,
    });
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
};

void main();
