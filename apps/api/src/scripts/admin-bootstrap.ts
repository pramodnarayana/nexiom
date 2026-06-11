import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Environment Variables (MUST BE FIRST)
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from '@soopa/database';
import * as identitySchema from '@soopa/identity/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  getRequiredOwnerRoleId,
  getRequiredAdminRoleId,
  getRequiredMemberRoleId,
  getRequiredSystemTenantId,
} from '../constants.js';
import {
  seedSystemRbac,
  DrizzleRbacRepository,
} from '@soopa/identity/utils/rbac-seeding';

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

async function seedRbac(client: Client) {
  console.log('3️⃣  Seeding RBAC (Roles & Permissions)...');

  // Get validated env vars (throws if missing)
  const config = {
    ownerRoleId: getRequiredOwnerRoleId(),
    adminRoleId: getRequiredAdminRoleId(),
    memberRoleId: getRequiredMemberRoleId(),
    systemTenantId: getRequiredSystemTenantId(),
  };

  // Create a new Drizzle instance scoped to the identity schema
  const identityDb = drizzle(client, { schema: identitySchema });
  await seedSystemRbac(new DrizzleRbacRepository(identityDb), config, console);
}

// Shared helper to elevate a user to System Owner
async function elevateToOwner(
  client: Client,
  db: NodePgDatabase<typeof schema>,
  email: string,
  skipSeed?: boolean,
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

  if (!skipSeed) {
    await seedRbac(client);
  }

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
      role: OWNER_ROLE_ID,
      createdAt: new Date(),
    });
    console.log(`✅ User assigned to System Tenant as Owner.`);
  } else {
    // Force update role to Owner if it's different
    if (existingMember[0].role !== OWNER_ROLE_ID) {
      await db
        .update(schema.member)
        .set({ role: OWNER_ROLE_ID })
        .where(eq(schema.member.id, existingMember[0].id));
      console.log(`✅ User role updated to System Owner.`);
    } else {
      console.log(`ℹ️  User is already a System Owner.`);
    }
  }

  console.log(`✅ User '${user.email}' is now a System Owner.`);
}

// --- Commands ---

// ------------------------------------------------------------------
// Environment Variable Strategy
// ------------------------------------------------------------------
// We support two sets of environment variables for admin credentials:
// 1. ADMIN_* (Preferred): Standard naming convention for current admin ops.
// 2. BOOTSTRAP_ADMIN_* (Legacy/Fallback): Often used in initial setup scripts.
//
// The script prioritizes ADMIN_* variables but falls back to BOOTSTRAP_ADMIN_*
// to ensure backward compatibility with existing CI/CD pipelines.
// ------------------------------------------------------------------

async function bootstrapAdmin() {
  const EMAIL = process.env.ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL;
  const PASSWORD =
    process.env.ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD;
  // Handle flexible name inputs
  const FULL_NAME =
    process.env.ADMIN_NAME ||
    process.env.BOOTSTRAP_ADMIN_NAME ||
    'Platform Admin';
  const FIRST_NAME = process.env.ADMIN_FIRST_NAME || FULL_NAME.split(' ')[0];
  const LAST_NAME =
    process.env.ADMIN_LAST_NAME ||
    FULL_NAME.split(' ').slice(1).join(' ') ||
    'User';

  if (!EMAIL || !PASSWORD) {
    console.error(
      'Error: ADMIN_EMAIL/PASSWORD (or BOOTSTRAP_ADMIN_*) must be set',
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
          firstName: FIRST_NAME,
          lastName: LAST_NAME,
          companyName: 'Nexiom Platform',
          role: 'admin',
        }),
      });

      if (signupRes.ok) {
        console.log('✅ User Account Created via API.');
      } else {
        const errBody = (await signupRes
          .json()
          .catch(() => ({ message: '' }))) as {
          message?: string;
          error?: string;
        };
        const errText = errBody.message || errBody.error || '';
        if (signupRes.status === 409 || errText.includes('already exists')) {
          console.log(
            'ℹ️  User likely already exists, proceeding to elevation...',
          );
        } else {
          console.error(
            '❌ API Signup Failed:',
            errText || signupRes.statusText,
          );
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

    await elevateToOwner(client, db, EMAIL);
    console.log(`Basic setup complete.`);
  } finally {
    await client.end();
  }
}

async function forceResetAdmin() {
  const EMAIL = process.env.ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL;
  const PASSWORD =
    process.env.ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const FULL_NAME =
    process.env.ADMIN_NAME ||
    process.env.BOOTSTRAP_ADMIN_NAME ||
    'Platform Admin';
  const FIRST_NAME = process.env.ADMIN_FIRST_NAME || FULL_NAME.split(' ')[0];
  const LAST_NAME =
    process.env.ADMIN_LAST_NAME ||
    FULL_NAME.split(' ').slice(1).join(' ') ||
    'User';
  const COMPANY_NAME = process.env.ADMIN_COMPANY_NAME ?? 'Nexiom Platform';
  const ROLE = process.env.ADMIN_ROLE ?? 'admin';

  if (!EMAIL || !PASSWORD) {
    console.error(
      'Error: ADMIN_EMAIL/PASSWORD (or BOOTSTRAP_ADMIN_*) must be set for reset',
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

    // 1. Safe Reset Logic: Rename -> Signup -> Delete Logic
    // This ensures we don't lose the admin if the API is down
    console.log('1️⃣  Initiating Safe Reset...');

    // Check if user exists
    const existing = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, EMAIL));

    if (existing.length > 0) {
      const userId = existing[0].id;
      const tempEmail = `archived_${Date.now()}_${EMAIL}`;

      console.log(
        `   Detailed: Renaming existing user to ${tempEmail} to clear namespace...`,
      );

      // Start transaction to Rename -> Try Create
      // We can't do the API call IN the transaction effectively for rollback,
      // but we can manually revert the rename if API fails.

      await db
        .update(schema.user)
        .set({ email: tempEmail })
        .where(eq(schema.user.id, userId));

      try {
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
        console.log('   ✅ User Re-created successfully via API.');

        // Success! Now we delete the old (archived) user data
        console.log('3️⃣  Cleaning up old user data...');
        await db.transaction(async (tx) => {
          await tx
            .delete(schema.session)
            .where(eq(schema.session.userId, userId));
          await tx
            .delete(schema.account)
            .where(eq(schema.account.userId, userId));
          // Handle related data with care - cascading usually handles it but explicit is safer for script
          await tx
            .delete(schema.member)
            .where(eq(schema.member.userId, userId));
          await tx
            .delete(schema.invitation)
            .where(eq(schema.invitation.inviterId, userId));
          await tx
            .delete(schema.invitation)
            .where(eq(schema.invitation.email, existing[0].email)); // Use original email for invites

          // Finally delete the user
          await tx.delete(schema.user).where(eq(schema.user.id, userId));
        });
        console.log('   ✅ cleanup complete.');
      } catch (error) {
        console.error(
          '❌ Reset Failed during API signup. Rolling back user state...',
        );
        // Rollback: Restore email
        await db
          .update(schema.user)
          .set({ email: EMAIL })
          .where(eq(schema.user.id, userId));
        console.log('   ✅ Rollback successful. Original user restored.');
        throw error;
      }
    } else {
      // User doesn't exist, simple create
      console.log('   User not found, proceeding to creation...');
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
      console.log('   ✅ User Created.');
    }

    // 4. Elevate to System Owner
    await elevateToOwner(client, db, EMAIL);
    console.log(`   Credentials: ${EMAIL} / ********`);
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
  default:
    console.log('Usage: tsx src/scripts/admin-bootstrap.ts <command>');
    console.log('Commands:');
    console.log('  bootstrap    - Safely create admin user if missing');
    console.log('  reset-admin  - Delete and recreate admin user');
    console.log('Note: For database reset, use: pnpm --filter api db:reset');
    process.exit(1);
}
