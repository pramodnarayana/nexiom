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

  const missing = [];
  if (!DATABASE_URL) missing.push('DATABASE_URL');
  if (!SYSTEM_TENANT_ID) missing.push('SYSTEM_TENANT_ID');
  if (!OWNER_ROLE_ID) missing.push('OWNER_ROLE_ID');
  if (!ADMIN_ROLE_ID) missing.push('ADMIN_ROLE_ID');
  if (!MEMBER_ROLE_ID) missing.push('MEMBER_ROLE_ID');

  if (missing.length > 0) {
    console.error(
      `FATAL: Missing required environment variables: ${missing.join(', ')}`,
    );
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
  let isProduction = false;
  let hostname = '';

  if (process.env.IS_PRODUCTION === 'true') {
    isProduction = true;
  } else {
    try {
      const url = new URL(dbUrl);
      hostname = url.hostname;
      // Strict allowed hostnames for non-production
      const allowedHosts = ['localhost', '127.0.0.1', 'postgres', 'db'];
      if (!allowedHosts.includes(hostname)) {
        // Any other host is considered production-candidate if not strictly allowed
        isProduction = true;
      }
    } catch (_error) {
      // If URL parsing fails, allow only if explicit force or known safe
      // We set isProduction true here to trigger the guard below
      isProduction = true;
    }
  }

  if (isProduction) {
    if (process.env.FORCE_RESET !== 'true') {
      console.error(
        `FATAL: Attempting to run reset-e2e against detected production database (${hostname || 'unknown'})!`,
      );
      console.error('To bypass, set FORCE_RESET=true');
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
  console.log('--- 2. Seeding RBAC ---');
  await client.query(
    `INSERT INTO "role" (id, name, "isSystem", description, "createdAt") VALUES
        ($1, 'Owner', true, 'Full access', NOW()),
        ($2, 'Admin', true, 'Manage users', NOW()),
        ($3, 'Member', true, 'Read only', NOW())
        ON CONFLICT (id) DO NOTHING;`,
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

  // Batch Insert Permissions using UNNEST
  await client.query(
    `INSERT INTO "permission" (id, resource, action, "createdAt")
        SELECT
          p as id,
          split_part(p, ':', 1) as resource,
          substring(p from position(':' in p) + 1) as action,
          NOW()
        FROM UNNEST($1::text[]) as pt(p)
     ON CONFLICT (id) DO NOTHING;`,
    [perms],
  );

  // Prepare Role Permissions in memory
  const rolePermRows: { id: string; r: string; p: string; o: string | null }[] =
    [];

  // Member (Read Only)
  // Filter for read-scoped non-system permissions
  const memberPerms = perms.filter(
    (p) => p.endsWith(':read') && !p.startsWith('system_'),
  );

  for (const p of memberPerms) {
    rolePermRows.push({
      id: uuidv4(),
      r: ids.member,
      p,
      o: null,
    });
  }

  for (const p of perms) {
    if (!p.startsWith('system_')) {
      // Admin (Global)
      rolePermRows.push({ id: uuidv4(), r: ids.admin, p, o: null });

      // Owner (Global) - except dashboard override
      if (p !== 'admin_dashboard:view') {
        rolePermRows.push({ id: uuidv4(), r: ids.owner, p, o: null });
      }
    } else {
      // System Permissions for Owner (Scoped)
      rolePermRows.push({ id: uuidv4(), r: ids.owner, p, o: ids.systemTenant });
    }
  }

  // Add back admin_dashboard:view for Owner in System Tenant
  rolePermRows.push({
    id: uuidv4(),
    r: ids.owner,
    p: 'admin_dashboard:view',
    o: ids.systemTenant,
  });

  // Batch Insert Role Permissions
  if (rolePermRows.length > 0) {
    const rpIds = rolePermRows.map((row) => row.id);
    const roles = rolePermRows.map((row) => row.r);
    const permissions = rolePermRows.map((row) => row.p);
    const orgs = rolePermRows.map((row) => row.o);

    await client.query(
      `INSERT INTO "role_permission" (id, "roleId", "permissionId", "organizationId")
       SELECT i, r, p, o
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) as t(i, r, p, o)
       ON CONFLICT (id) DO NOTHING;`,
      [rpIds, roles, permissions, orgs],
    );
  }
};

const seedUsersAndTenants = async (
  client: Client,
  ids: {
    systemTenant: string;
    owner: string;
  },
) => {
  console.log('--- 3. Seeding Organizations ---');
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
  validateEnv(env.DATABASE_URL as string);

  console.log('Connecting to DB...');
  const client = new Client({ connectionString: env.DATABASE_URL });

  try {
    await client.connect();
    await truncateTables(client);
    await seedRBAC(client, {
      owner: env.OWNER_ROLE_ID as string,
      admin: env.ADMIN_ROLE_ID as string,
      member: env.MEMBER_ROLE_ID as string,
      systemTenant: env.SYSTEM_TENANT_ID as string,
    });
    await seedUsersAndTenants(client, {
      systemTenant: env.SYSTEM_TENANT_ID as string,
      owner: env.OWNER_ROLE_ID as string,
    });
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
};

void main();
