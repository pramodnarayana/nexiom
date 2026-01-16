import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load Environment Variables
// Current Dir: apps/api/src/scripts
// API Root: ../../
// Repo Root: ../../../../

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const API_URL = 'http://localhost:3000/api';
const EMAIL = 'pramod.narayana@gmail.com';
const PASSWORD = 'password123';
const NAME = 'Pramod Admin';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL not found!');
  process.exit(1);
}

const client = new Client({ connectionString: dbUrl });

async function bootstrap() {
  console.log('🚀 Starting Admin Bootstrap...');

  // 1. Create User via API (Handles Password Hashing)
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
          'ℹ️  User likely already exists (API returned error), proceeding to elevation...',
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
  console.log('2️⃣  Elevating to Platform Admin...');
  await client.connect();
  const db = drizzle(client, { schema });

  console.log(`Searching for: ${EMAIL}`);
  const users = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, EMAIL));

  if (users.length === 0) {
    console.error('❌ User not found in DB after API call.');
    await client.end();
    process.exit(1);
  }

  const user = users[0];

  await db
    .update(schema.user)
    .set({ systemRole: 'platform_admin' })
    .where(eq(schema.user.id, user.id));

  console.log(
    `✅ User '${user.name}' (${user.email}) is now a PLATFORM ADMIN.`,
  );

  console.log('\n--------- CREDENTIALS ---------');
  console.log(`URL:      http://localhost:5173/login`);
  console.log(`Email:    ${EMAIL}`);
  console.log(`Password: ${PASSWORD}`);
  console.log('-------------------------------');

  await client.end();
}

void bootstrap();
