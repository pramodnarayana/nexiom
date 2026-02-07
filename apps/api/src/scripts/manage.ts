import * as dotenv from 'dotenv';
import * as path from 'node:path';

// Load Environment Variables (MUST BE FIRST)
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { v4 as uuidv4 } from 'uuid';
import {
  getRequiredOwnerRoleId,
  getRequiredAdminRoleId,
  getRequiredMemberRoleId,
  getRequiredSystemTenantId,
  ALL_PERMISSIONS,
} from '../constants';

const API_URL = process.env.API_URL ?? 'http://localhost:3000/api';
const ALLOWED_ENVS = ['development', 'test', 'local'];

const isAllowedEnv = (): boolean => {
  const env = process.env.NODE_ENV;
  return env ? ALLOWED_ENVS.includes(env) : false;
};

// Shared Utils
const getDbClient = () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL not found!');
    process.exit(1);
  }
  return new Client({ connectionString: dbUrl });
};

// --- Helpers ---

async function seedRbac(db: NodePgDatabase<typeof schema>) {
  console.log('3️⃣  Seeding RBAC (Roles & Permissions)...');

  // Get validated env vars (throws if missing)
  const OWNER_ROLE_ID = getRequiredOwnerRoleId();
  const ADMIN_ROLE_ID = getRequiredAdminRoleId();
  const MEMBER_ROLE_ID = getRequiredMemberRoleId();
  const SYSTEM_TENANT_ID = getRequiredSystemTenantId();

  // --- Definitions ---
  const ROLES = [
    {
      id: OWNER_ROLE_ID,
      name: 'Owner',
      isSystem: true,
      description: 'Full access',
    },
    {
      id: ADMIN_ROLE_ID,
      name: 'Admin',
      isSystem: true,
      description: 'Manage users and settings',
    },
    {
      id: MEMBER_ROLE_ID,
      name: 'Member',
      isSystem: true,
      description: 'Read only access',
    },
  ];

  // Master list of all available permissions in the system
  const ALL_DEFINED_PERMISSIONS = ALL_PERMISSIONS;

  // Explicit Role Assignments
  const OWNER_PERMISSIONS = ALL_DEFINED_PERMISSIONS; // Owner gets everything
  const ADMIN_PERMISSIONS = ALL_DEFINED_PERMISSIONS; // Admin gets everything too (Differentiation is via text/scope)
  const MEMBER_PERMISSIONS = ['users:read', 'tenants:read']; // Member gets read-only

  // --- 1. Ensure Roles Exist ---
  await db.insert(schema.role).values(ROLES).onConflictDoNothing();

  // --- 2. Ensure Permissions Exist ---
  const permissionsToInsert = ALL_DEFINED_PERMISSIONS.map((p) => {
    const colonIdx = p.indexOf(':');
    if (colonIdx === -1) {
      throw new Error(
        `Malformed permission: "${p}" - must contain a colon to separate resource and action`,
      );
    }
    const resource = p.substring(0, colonIdx);
    const action = p.substring(colonIdx + 1);
    return {
      id: p,
      resource,
      action,
      createdAt: new Date(),
    };
  });

  await db
    .insert(schema.permission)
    .values(permissionsToInsert)
    .onConflictDoNothing();

  // --- 3. Assign Permissions to Roles (Batch Insert) ---

  const rolePermissionsToInsert: Array<{
    id: string;
    roleId: string;
    permissionId: string;
    organizationId: string | null;
  }> = [];

  // A. OWNER
  // Owners have system permissions SCOPED to the System Tenant, and global permissions elsewhere.
  for (const p of OWNER_PERMISSIONS) {
    const isSystem = p.startsWith('system_') || p === 'admin_dashboard:view';
    const orgId = isSystem ? SYSTEM_TENANT_ID : null;
    rolePermissionsToInsert.push({
      id: uuidv4(),
      roleId: OWNER_ROLE_ID,
      permissionId: p,
      organizationId: orgId,
    });
  }

  // B. ADMIN
  // Admins also have system permissions if scoped to System Tenant.
  for (const p of ADMIN_PERMISSIONS) {
    const isSystem = p.startsWith('system_') || p === 'admin_dashboard:view';
    const orgId = isSystem ? SYSTEM_TENANT_ID : null;
    rolePermissionsToInsert.push({
      id: uuidv4(),
      roleId: ADMIN_ROLE_ID,
      permissionId: p,
      organizationId: orgId,
    });
  }

  // C. MEMBER
  // Members have global read-only permissions.
  for (const p of MEMBER_PERMISSIONS) {
    rolePermissionsToInsert.push({
      id: uuidv4(),
      roleId: MEMBER_ROLE_ID,
      permissionId: p,
      organizationId: null,
    });
  }

  // Single batch insert for all role permissions
  await db
    .insert(schema.rolePermission)
    .values(rolePermissionsToInsert)
    .onConflictDoNothing();

  console.log('   ✅ RBAC (Owner, Admin, Member) Seeded Successfully.');
}

// Shared helper to elevate a user to System Owner
async function elevateToOwner(
  db: NodePgDatabase<typeof schema>,
  email: string,
): Promise<void> {
  // Get validated env vars (throws if missing)
  const OWNER_ROLE_ID = getRequiredOwnerRoleId();
  const SYSTEM_TENANT_ID = getRequiredSystemTenantId();

  // Ensure System Tenant
  const systemTenant = await db.query.organization.findFirst({
    where: eq(schema.organization.id, SYSTEM_TENANT_ID),
  });

  if (!systemTenant) {
    console.log(`Creating System Tenant (${SYSTEM_TENANT_ID})...`);
    await db
      .insert(schema.organization)
      .values({
        id: SYSTEM_TENANT_ID,
        name: 'Nexiom Platform',
        slug: 'system',
      })
      .onConflictDoNothing();
  }

  // Ensure Role (use canonical name to match seedRbac)
  await db
    .insert(schema.role)
    .values({
      id: OWNER_ROLE_ID,
      name: 'Owner',
      isSystem: true,
      description: 'Full access',
    })
    .onConflictDoNothing();

  await seedRbac(db);

  // Find user
  const users = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email));

  if (users.length === 0) {
    console.error(`❌ User not found in DB: ${email}`);
    process.exit(1);
  }

  const user = users[0];

  // Set email as verified
  await db
    .update(schema.user)
    .set({ emailVerified: true })
    .where(eq(schema.user.id, user.id));

  // Check if member exists
  const existingMember = await db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, user.id),
        eq(schema.member.organizationId, SYSTEM_TENANT_ID),
      ),
    );

  if (existingMember.length === 0) {
    await db.insert(schema.member).values({
      id: uuidv4(),
      userId: user.id,
      organizationId: SYSTEM_TENANT_ID,
      roleId: OWNER_ROLE_ID,
      createdAt: new Date(),
    });
    console.log(`✅ User assigned to System Tenant as Owner.`);
  } else {
    // Force update role to Owner if it's different
    if (existingMember[0].roleId !== OWNER_ROLE_ID) {
      await db
        .update(schema.member)
        .set({ roleId: OWNER_ROLE_ID })
        .where(eq(schema.member.id, existingMember[0].id));
      console.log(`✅ User role updated to System Owner.`);
    } else {
      console.log(`ℹ️  User is already a System Owner.`);
    }
  }

  console.log(`✅ User '${user.email}' is now a System Owner.`);
}

// --- Commands ---

async function bootstrapAdmin() {
  const EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const NAME = process.env.BOOTSTRAP_ADMIN_NAME ?? 'Platform Admin';

  if (!EMAIL || !PASSWORD) {
    console.error(
      'Error: BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be set',
    );
    process.exit(1);
  }

  console.log('🚀 Starting Admin Bootstrap...');
  const client = getDbClient();

  try {
    // 1. Create User via API
    console.log('1️⃣  Creating User Account via API...');
    try {
      const signupRes = await fetch(`${API_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: EMAIL,
          password: PASSWORD,
          firstName: NAME.split(' ')[0],
          lastName: NAME.split(' ')[1] || '',
          companyName: 'Nexiom Platform',
          role: 'admin',
        }),
      });

      if (signupRes.ok) {
        console.log('✅ User Account Created via API.');
      } else {
        const err = await signupRes.text();
        if (err.includes('already exists') || signupRes.status === 400) {
          console.log(
            'ℹ️  User likely already exists, proceeding to elevation...',
          );
        } else {
          console.error('❌ API Signup Failed:', err);
          process.exit(1);
        }
      }
    } catch (e) {
      console.error(
        '❌ Failed to contact API. Is the server running? (pnpm dev)',
        e,
      );
      process.exit(1);
    }

    // 2. Elevate to Platform Admin via DB
    await client.connect();
    const db = drizzle(client, { schema });

    // Get validated env vars (throws if missing)
    const OWNER_ROLE_ID = getRequiredOwnerRoleId();
    const SYSTEM_TENANT_ID = getRequiredSystemTenantId();

    // Ensure System Tenant
    const systemTenant = await db.query.organization.findFirst({
      where: eq(schema.organization.id, SYSTEM_TENANT_ID),
    });

    if (!systemTenant) {
      console.log(`Creating System Tenant (${SYSTEM_TENANT_ID})...`);
      await db
        .insert(schema.organization)
        .values({
          id: SYSTEM_TENANT_ID,
          name: 'Nexiom Platform',
          slug: 'system',
        })
        .onConflictDoNothing();
    }

    // Ensure Role
    await db
      .insert(schema.role)
      .values({
        id: OWNER_ROLE_ID,
        name: 'System Owner',
        isSystem: true,
        description: 'Super administrator for the platform',
      })
      .onConflictDoNothing();

    await seedRbac(db);

    // Assign Role
    const users = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, EMAIL));
    if (users.length === 0) {
      console.error('❌ User not found in DB after API call.');
      process.exit(1);
    }
    const user = users[0];

    // Check if member exists
    const existingMember = await db
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.userId, user.id),
          eq(schema.member.organizationId, SYSTEM_TENANT_ID),
        ),
      );

    if (existingMember.length === 0) {
      await db.insert(schema.member).values({
        id: uuidv4(),
        userId: user.id,
        organizationId: SYSTEM_TENANT_ID,
        roleId: OWNER_ROLE_ID,
        createdAt: new Date(),
      });
      console.log(`✅ User assigned to System Tenant as Owner.`);
    } else {
      // Force update role to Owner if it's different
      if (existingMember[0].roleId === OWNER_ROLE_ID) {
        console.log(`ℹ️  User is already a System Owner.`);
      } else {
        await db
          .update(schema.member)
          .set({ roleId: OWNER_ROLE_ID })
          .where(eq(schema.member.id, existingMember[0].id));
        console.log(`✅ User role updated to System Owner.`);
      }
    }

    console.log(`✅ User '${user.email}' is now a System Owner.`);
    console.log(`Basic setup complete.`);
  } finally {
    await client.end();
  }
}

async function forceResetAdmin() {
  const EMAIL = process.env.ADMIN_EMAIL;
  const PASSWORD = process.env.ADMIN_PASSWORD;
  const FIRST_NAME = process.env.ADMIN_FIRST_NAME ?? 'Admin';
  const LAST_NAME = process.env.ADMIN_LAST_NAME ?? 'User';
  const COMPANY_NAME = process.env.ADMIN_COMPANY_NAME ?? 'Nexiom Platform';
  const ROLE = process.env.ADMIN_ROLE ?? 'admin';

  if (!EMAIL || !PASSWORD) {
    console.error(
      'Error: ADMIN_EMAIL and ADMIN_PASSWORD must be set for reset',
    );
    process.exit(1);
  }

  console.log(`🚀 Force Resetting Admin User: ${EMAIL}`);

  if (!isAllowedEnv()) {
    console.error(
      `❌ Cannot force reset admin in ${process.env.NODE_ENV || 'unset'} environment! Only allowed in: ${ALLOWED_ENVS.join(', ')}`,
    );
    process.exit(1);
  }

  const client = getDbClient();

  try {
    await client.connect();
    const db = drizzle(client, { schema });

    // 1. Delete Existing
    console.log('1️⃣  Deleting existing user record...');
    const existing = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, EMAIL));
    if (existing.length > 0) {
      const userId = existing[0].id;
      // Cascade delete manually in transaction for atomicity
      await db.transaction(async (tx) => {
        await tx
          .delete(schema.session)
          .where(eq(schema.session.userId, userId));
        await tx
          .delete(schema.account)
          .where(eq(schema.account.userId, userId));
        await tx.delete(schema.member).where(eq(schema.member.userId, userId));
        await tx
          .delete(schema.invitation)
          .where(eq(schema.invitation.inviterId, userId));
        await tx
          .delete(schema.invitation)
          .where(eq(schema.invitation.email, existing[0].email));
        await tx.delete(schema.user).where(eq(schema.user.id, userId));
      });
      console.log('   ✅ User and related data deleted.');
    }

    // 2. Re-create via API
    console.log('2️⃣  Creating User via API...');
    const res = await fetch(`${API_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
        companyName: COMPANY_NAME,
        role: ROLE,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API Signup Failed: ${text}`);
    }
    console.log('   ✅ User Re-created successfully.');

    // 3. Elevate to System Owner
    await elevateToOwner(db, EMAIL);
    console.log(`   Credentials: ${EMAIL} / ********`);
  } finally {
    await client.end();
  }
}

async function resetDb() {
  if (!isAllowedEnv()) {
    console.error(
      `❌ Cannot reset database in ${process.env.NODE_ENV || 'unset'} environment! Only allowed in: ${ALLOWED_ENVS.join(', ')}`,
    );
    process.exit(1);
  }

  console.log('⚠️  Resetting Database (Truncating Data)...');
  const client = getDbClient();
  await client.connect();

  try {
    await client.query(`
            TRUNCATE TABLE 
                "invitation",
                "member",
                "session",
                "account",
                "verification",
                "organization",
                "user"
            CASCADE;
        `);
    console.log('✅ Database Cleaned.');
  } catch (err) {
    console.error('Error resetting DB:', err);
    throw err; // Re-throw to propagate to CLI's .catch() handler
  } finally {
    await client.end();
  }
}

// --- Main CLI ---

const command = process.argv[2];

switch (command) {
  case 'bootstrap':
    bootstrapAdmin().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  case 'reset-admin':
    forceResetAdmin().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  case 'reset-db':
    resetDb().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  default:
    console.log('Usage: ts-node manage.ts <command>');
    console.log('Commands:');
    console.log('  bootstrap    - Safely create admin user if missing');
    console.log('  reset-admin  - Delete and recreate admin user');
    console.log('  reset-db     - Truncate all data (Dev only)');
    process.exit(1);
}
