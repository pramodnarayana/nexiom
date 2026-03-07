import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import * as dotEnv from 'dotenv';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_PERMISSIONS, isSystemPermission } from '../constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from apps/api root
dotEnv.config({ path: path.resolve(__dirname, '../../.env') });

const assertEnv = (val: string | undefined, name: string): string => {
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
};

const loadEnv = () => {
  const {
    DATABASE_URL,
    SYSTEM_TENANT_ID,
    OWNER_ROLE_ID,
    ADMIN_ROLE_ID,
    MEMBER_ROLE_ID,
  } = process.env;

  try {
    return {
      DATABASE_URL: assertEnv(DATABASE_URL, 'DATABASE_URL'),
      SYSTEM_TENANT_ID: assertEnv(SYSTEM_TENANT_ID, 'SYSTEM_TENANT_ID'),
      OWNER_ROLE_ID: assertEnv(OWNER_ROLE_ID, 'OWNER_ROLE_ID'),
      ADMIN_ROLE_ID: assertEnv(ADMIN_ROLE_ID, 'ADMIN_ROLE_ID'),
      MEMBER_ROLE_ID: assertEnv(MEMBER_ROLE_ID, 'MEMBER_ROLE_ID'),
    };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error(`FATAL: ${errorMsg}`);
    process.exit(1);
  }
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

  const errors: { table: string; error: unknown }[] = [];

  for (const table of tables) {
    try {
      await client.query(`TRUNCATE TABLE "${table}" CASCADE;`);
    } catch (e) {
      console.error(`Error truncating table "${table}":`, e);
      errors.push({ table, error: e });
    }
  }

  if (errors.length > 0) {
    console.error('FATAL: Failed to truncate tables', errors);
    throw new Error('Table truncation failed');
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

  const perms = ALL_PERMISSIONS;

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

  // Helper to push
  const add = (r: string, p: string, o: string | null) => {
    rolePermRows.push({ id: uuidv4(), r, p, o });
  };

  // 1. Member (Read Only)
  // Match PermissionSeeder: 'users:read', 'tenants:read'
  const memberPerms = ['users:read', 'tenants:read'] as const;
  for (const p of memberPerms) {
    // Only add if it exists in ALL_PERMISSIONS (safety check)
    if ((perms as readonly string[]).includes(p)) {
      add(ids.member, p, null);
    }
  }

  // 2. Admin & Owner
  // Both share same logic: Global perms -> global scope; System perms -> system tenant scope
  const targetRoles = [ids.admin, ids.owner];

  for (const roleId of targetRoles) {
    // Global Permissions
    const globalPerms = perms.filter((p) => !isSystemPermission(p));
    for (const p of globalPerms) {
      add(roleId, p, null);
    }

    // System Permissions
    const systemPerms = perms.filter((p) => isSystemPermission(p));
    for (const p of systemPerms) {
      add(roleId, p, ids.systemTenant);
    }
  }

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
  validateEnv(env.DATABASE_URL);

  console.log('Connecting to DB...');
  const client = new Client({ connectionString: env.DATABASE_URL });

  try {
    await client.connect();
    await client.query('BEGIN');
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
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
};

void main();
