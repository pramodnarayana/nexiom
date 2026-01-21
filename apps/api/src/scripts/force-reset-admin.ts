import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Fix path resolution for env files - go up from src/scripts
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const API_URL = 'http://localhost:3000/api';
const EMAIL = 'pramod.narayana@gmail.com';
const PASSWORD = 'password123';
const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error('❌ DATABASE_URL not found! Check your .env files.');
  process.exit(1);
}

const client = new Client({ connectionString: dbUrl });

async function reset() {
  console.log(`🚀 Force Resetting Admin User: ${EMAIL}`);
  console.log(`   Target DB: ${dbUrl}`);

  await client.connect();
  const db = drizzle(client, { schema });

  // 1. Delete existing user
  console.log('1️⃣  Deleting existing user record...');
  try {
    // Note: This might fail if there are foreign key constraints like 'member' or 'session'
    // We should try to clear those too if we can, but let's try a simple delete first
    // or assume cascade is configured in DB (though drizzle schema definitions matter).
    // To be safe, let's look up the user ID first.
    const existing = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, EMAIL));

    if (existing.length > 0) {
      const userId = existing[0].id;
      // Delete dependencies manually to be safe (matching bootstrap-admin logic/e2e tests)
      // We need to import tables properly. Assuming schema has them.
      if (schema.session)
        await db
          .delete(schema.session)
          .where(eq(schema.session.userId, userId));
      if (schema.account)
        await db
          .delete(schema.account)
          .where(eq(schema.account.userId, userId));
      if (schema.member)
        await db.delete(schema.member).where(eq(schema.member.userId, userId));
      // Deleting invitations sent by this user
      if (schema.invitation)
        await db
          .delete(schema.invitation)
          .where(eq(schema.invitation.inviterId, userId));

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
        firstName: 'Pramod',
        lastName: 'Narayana',
        companyName: 'Nexiom Admin',
        role: 'admin',
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`❌ API Signup Failed: ${res.status}`);
      console.error(text);
      process.exit(1);
    }
    console.log('   ✅ User Re-created successfully via API.');
  } catch (e) {
    console.error(
      '❌ Failed to contact API. Is the server running on localhost:3000?',
      e,
    );
    process.exit(1);
  }

  // 3. Elevate Role
  console.log('3️⃣  Elevating to Platform Admin...');
  const users = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, EMAIL));

  if (users.length) {
    await db
      .update(schema.user)
      .set({ systemRole: 'platform_admin', emailVerified: true })
      .where(eq(schema.user.id, users[0].id));
    console.log('   ✅ Role updated to platform_admin.');

    console.log('\n🎉 SUCCESS! You can now login.');
    console.log(`   URL:      http://localhost:5173/login`);
    console.log(`   Email:    ${EMAIL}`);
    console.log(`   Password: ${PASSWORD}`);
  } else {
    console.error(
      '❌ CRITICAL: User not found in DB after creation! Something is wrong.',
    );
  }

  await client.end();
}

reset().catch((err) => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
