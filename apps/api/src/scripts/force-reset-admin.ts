import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { SYSTEM_TENANT_ID, PLATFORM_ADMIN_ROLE_ID } from '@nexiom/identity';

// Fix path resolution for env files - go up from src/scripts
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Check env vars first
const requiredEnv = [
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'ADMIN_FIRST_NAME',
  'ADMIN_LAST_NAME',
  'ADMIN_COMPANY_NAME',
  'ADMIN_ROLE',
  'DATABASE_URL',
];

const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  console.error(
    `❌ Error: The following environment variables are required: ${missingEnv.join(', ')}`,
  );
  process.exit(1);
}

const API_URL = 'http://localhost:3000/api';
const EMAIL = process.env.ADMIN_EMAIL as string;
const PASSWORD = process.env.ADMIN_PASSWORD as string;
const dbUrl = process.env.DATABASE_URL as string;
const FIRST_NAME = process.env.ADMIN_FIRST_NAME as string;
const LAST_NAME = process.env.ADMIN_LAST_NAME as string;
const COMPANY_NAME = process.env.ADMIN_COMPANY_NAME as string;
const ROLE = process.env.ADMIN_ROLE as string;

const client = new Client({ connectionString: dbUrl });

async function reset() {
  console.log(`🚀 Force Resetting Admin User: ${EMAIL}`);
  // Redacted DB URL for security
  console.log(`   Target DB: [REDACTED]`);

  try {
    await client.connect();
    const db = drizzle(client, { schema });

    // 1. Delete existing user
    console.log('1️⃣  Deleting existing user record...');
    try {
      const existing = await db
        .select()
        .from(schema.user)
        .where(eq(schema.user.email, EMAIL));

      if (existing.length > 0) {
        const userId = existing[0].id;
        // Delete dependencies manually to be safe (matching bootstrap-admin logic/e2e tests)
        await db
          .delete(schema.session)
          .where(eq(schema.session.userId, userId));
        await db
          .delete(schema.account)
          .where(eq(schema.account.userId, userId));
        await db.delete(schema.member).where(eq(schema.member.userId, userId));
        // Deleting invitations sent by this user
        await db
          .delete(schema.invitation)
          .where(eq(schema.invitation.inviterId, userId));

        // Use email from existing[0] instead of EMAIL constant to be safe, though they should match
        const userEmail = existing[0].email;
        // Also delete invitations where this user is the RECIPIENT
        await db
          .delete(schema.invitation)
          .where(eq(schema.invitation.email, userEmail));

        await db.delete(schema.user).where(eq(schema.user.id, userId));
        console.log('   ✅ User and related data deleted.');
      } else {
        console.log('   ℹ️  User does not exist, skipping delete.');
      }
    } catch (e) {
      console.error('   ⚠️  Error during cleanup (continuing...):', e);
    }

    // 2. Create via API
    console.log('2️⃣  Creating User via API (to handle password hashing)...');
    try {
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
        console.error(`❌ API Signup Failed: ${res.status}`);
        console.error(text);
        throw new Error('API Signup Failed');
      }
      console.log('   ✅ User Re-created successfully via API.');
    } catch (e) {
      console.error(
        '❌ Failed to contact API. Is the server running on localhost:3000?',
        e,
      );
      throw e;
    }

    // 3. Elevate Role
    console.log('3️⃣  Elevating to Platform Admin...');
    const users = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, EMAIL));

    if (users.length) {
      // 1. Mark email as verified
      await db
        .update(schema.user)
        .set({ emailVerified: true })
        .where(eq(schema.user.id, users[0].id));

      // 2. Add to System Tenant
      const existingMembers = await db
        .select()
        .from(schema.member)
        .where(eq(schema.member.userId, users[0].id));

      if (existingMembers.length === 0) {
        await db.insert(schema.member).values({
          id: uuidv4(),
          organizationId: SYSTEM_TENANT_ID,
          userId: users[0].id,
          roleId: PLATFORM_ADMIN_ROLE_ID,
          createdAt: new Date(),
        });
        console.log(`   ✅ Role updated to ${ROLE}.`);
      } else {
        console.log('   ℹ️  User is already a member of the system tenant.');
      }

      console.log('\n🎉 SUCCESS! You can now login.');
      console.log(`   URL:      http://localhost:5173/login`);
      console.log(`   Email:    ${EMAIL}`);
      console.log(`   Password: ********`); // Fully Masked
    } else {
      throw new Error('User not found in DB after creation');
    }
  } finally {
    await client.end();
  }
}

reset().catch((err) => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
