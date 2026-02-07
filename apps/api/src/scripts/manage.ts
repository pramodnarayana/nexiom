import * as dotenv from 'dotenv';
import * as path from 'node:path';

// Load Environment Variables (MUST BE FIRST)
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  REQUIRED_OWNER_ROLE_ID,
  REQUIRED_ADMIN_ROLE_ID,
  REQUIRED_MEMBER_ROLE_ID,
  REQUIRED_SYSTEM_TENANT_ID,
  ALL_PERMISSIONS,
} from '../constants';

const API_URL = process.env.API_URL ?? 'http://localhost:3000/api';

// Shared Utils
const getDbClient = () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL not found!');
    process.exit(1);
  }
  return new Client({ connectionString: dbUrl });
};

import { NodePgDatabase } from 'drizzle-orm/node-postgres';

// --- Helpers ---

async function seedRbac(db: NodePgDatabase<typeof schema>) {
  console.log('3️⃣  Seeding RBAC (Roles & Permissions)...');

  // --- Definitions ---
  const ROLES = [
    {
      id: REQUIRED_OWNER_ROLE_ID,
      name: 'System Owner',
      isSystem: true,
      description: 'Full access',
    },
    {
      id: REQUIRED_ADMIN_ROLE_ID,
      name: 'Admin',
      isSystem: true,
      description: 'Manage users and settings',
    },
    {
      id: REQUIRED_MEMBER_ROLE_ID,
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
  for (const r of ROLES) {
    await db.insert(schema.role).values(r).onConflictDoNothing();
  }

  // --- 2. Ensure Permissions Exist ---
  for (const p of ALL_DEFINED_PERMISSIONS) {
    const [resource, action] = p.split(':');
    await db
      .insert(schema.permission)
      .values({
        id: p,
        resource,
        action,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  }

  // --- 3. Assign Permissions to Roles ---

  // Helper to assign
  const assign = async (
    roleId: string,
    permId: string,
    orgId: string | null = null,
  ) => {
    await db
      .insert(schema.rolePermission)
      .values({
        id: uuidv4(),
        roleId,
        permissionId: permId,
        organizationId: orgId,
      })
      .onConflictDoNothing();
  };

  // A. OWNER
  // Owners have system permissions SCOPED to the System Tenant, and global permissions elsewhere.
  for (const p of OWNER_PERMISSIONS) {
    const isSystem = p.startsWith('system_') || p === 'admin_dashboard:view';
    const orgId = isSystem ? REQUIRED_SYSTEM_TENANT_ID : null;
    await assign(REQUIRED_OWNER_ROLE_ID, p, orgId);
  }

  // B. ADMIN
  // Admins also have system permissions if scoped to System Tenant.
  for (const p of ADMIN_PERMISSIONS) {
    const isSystem = p.startsWith('system_') || p === 'admin_dashboard:view';
    const orgId = isSystem ? REQUIRED_SYSTEM_TENANT_ID : null;
    await assign(REQUIRED_ADMIN_ROLE_ID, p, orgId);
  }

  // C. MEMBER
  // Members have global read-only permissions.
  for (const p of MEMBER_PERMISSIONS) {
    await assign(REQUIRED_MEMBER_ROLE_ID, p, null);
  }

  console.log('   ✅ RBAC (Owner, Admin, Member) Seeded Successfully.');
}

// --- Commands ---

async function bootstrapAdmin() {
  const EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL as string;
  const PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD as string;
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

    // Ensure System Tenant
    const systemTenant = await db.query.organization.findFirst({
      where: eq(schema.organization.id, REQUIRED_SYSTEM_TENANT_ID),
    });

    if (!systemTenant) {
      console.log(`Creating System Tenant (${REQUIRED_SYSTEM_TENANT_ID})...`);
      await db
        .insert(schema.organization)
        .values({
          id: REQUIRED_SYSTEM_TENANT_ID,
          name: 'Nexiom Platform',
          slug: 'system',
        })
        .onConflictDoNothing();
    }

    // Ensure Role
    await db
      .insert(schema.role)
      .values({
        id: REQUIRED_OWNER_ROLE_ID,
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
          eq(schema.member.organizationId, REQUIRED_SYSTEM_TENANT_ID),
        ),
      );

    if (existingMember.length === 0) {
      await db.insert(schema.member).values({
        id: uuidv4(),
        userId: user.id,
        organizationId: REQUIRED_SYSTEM_TENANT_ID,
        roleId: REQUIRED_OWNER_ROLE_ID,
        createdAt: new Date(),
      });
      console.log(`✅ User assigned to System Tenant as Owner.`);
    } else {
      // Force update role to Owner if it's different
      if (existingMember[0].roleId === REQUIRED_OWNER_ROLE_ID) {
        console.log(`ℹ️  User is already a System Owner.`);
      } else {
        await db
          .update(schema.member)
          .set({ roleId: REQUIRED_OWNER_ROLE_ID })
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
  const EMAIL = process.env.ADMIN_EMAIL as string;
  const PASSWORD = process.env.ADMIN_PASSWORD as string;
  const FIRST_NAME = process.env.ADMIN_FIRST_NAME as string;
  const LAST_NAME = process.env.ADMIN_LAST_NAME as string;
  const COMPANY_NAME = process.env.ADMIN_COMPANY_NAME as string;
  const ROLE = process.env.ADMIN_ROLE as string;

  if (!EMAIL || !PASSWORD) {
    console.error(
      'Error: ADMIN_EMAIL and ADMIN_PASSWORD must be set for reset',
    );
    process.exit(1);
  }

  console.log(`🚀 Force Resetting Admin User: ${EMAIL}`);

  if (process.env.NODE_ENV === 'production') {
    console.error(
      '❌ Cannot force reset admin in production! Use the dashboard or manual DB access if absolutely necessary.',
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
      // Cascade delete manually for safety/simulation of clean state
      await db.delete(schema.session).where(eq(schema.session.userId, userId));
      await db.delete(schema.account).where(eq(schema.account.userId, userId));
      await db.delete(schema.member).where(eq(schema.member.userId, userId));
      await db
        .delete(schema.invitation)
        .where(eq(schema.invitation.inviterId, userId));
      await db
        .delete(schema.invitation)
        .where(eq(schema.invitation.email, existing[0].email));
      await db.delete(schema.user).where(eq(schema.user.id, userId));
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

    // 3. Elevate Role (Duplicate logic from bootstrap but explicitly for this flow)
    const users = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, EMAIL));
    if (users.length) {
      await db
        .update(schema.user)
        .set({ emailVerified: true })
        .where(eq(schema.user.id, users[0].id));

      // Ensure system tenant membership
      const existingMembers = await db
        .select()
        .from(schema.member)
        .where(
          and(
            eq(schema.member.userId, users[0].id),
            eq(schema.member.organizationId, REQUIRED_SYSTEM_TENANT_ID),
          ),
        );

      if (existingMembers.length === 0) {
        await db.insert(schema.member).values({
          id: uuidv4(),
          organizationId: REQUIRED_SYSTEM_TENANT_ID,
          userId: users[0].id,
          roleId: REQUIRED_OWNER_ROLE_ID,
          createdAt: new Date(),
        });
      } else {
        await db
          .update(schema.member)
          .set({ roleId: REQUIRED_OWNER_ROLE_ID })
          .where(
            and(
              eq(schema.member.userId, users[0].id),
              eq(schema.member.organizationId, REQUIRED_SYSTEM_TENANT_ID),
            ),
          );
      }

      await seedRbac(db);

      console.log(`   ✅ User elevated to System Owner.`);
      console.log(`   Credentials: ${EMAIL} / ********`);
    }
  } finally {
    await client.end();
  }
}

async function resetDb() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Cannot reset database in production!');
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
  } finally {
    await client.end();
  }
}

// --- Main CLI ---

const command = process.argv[2];

switch (command) {
  case 'bootstrap':
    bootstrapAdmin().catch(console.error);
    break;
  case 'reset-admin':
    forceResetAdmin().catch(console.error);
    break;
  case 'reset-db':
    resetDb().catch(console.error);
    break;
  default:
    console.log('Usage: ts-node manage.ts <command>');
    console.log('Commands:');
    console.log('  bootstrap    - Safely create admin user if missing');
    console.log('  reset-admin  - Delete and recreate admin user');
    console.log('  reset-db     - Truncate all data (Dev only)');
    process.exit(1);
}
