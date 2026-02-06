import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  REQUIRED_ADMIN_ROLE_ID,
  REQUIRED_SYSTEM_TENANT_ID,
} from '../constants';

// ... (Environment loading)

// ...

// Current Dir: apps/api/src/scripts
// API Root: ../../
// Repo Root: ../../../../

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const API_URL = process.env.API_URL ?? 'http://localhost:3000/api';
const EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL as string;
const PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD as string;
const NAME = process.env.BOOTSTRAP_ADMIN_NAME ?? 'Platform Admin';

if (
  !process.env.BOOTSTRAP_ADMIN_EMAIL ||
  !process.env.BOOTSTRAP_ADMIN_PASSWORD
) {
  console.error(
    'Error: BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be set',
  );
  process.exit(1);
}

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

  // 2. Elevate to Platform Admin via DB (Seed System Tenant)
  console.log('2️⃣  Elevating to Platform Admin (Seeding System Tenant)...');
  await client.connect();
  const db = drizzle(client, { schema });

  // Ensure System Tenant Exists
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

  // Ensure Platform Admin Role Exists in System Tenant
  // We need to fetch the inserted/existing tenant first if we needed its ID, but we have it constant.

  // Fetch or Create "Platform Admin" Role
  // Note: logic assumes the role exists or we create it.
  // Ideally, better-auth might manage roles, but here we are manual.

  // Actually, we should check if the user is already a member of the System Tenant.

  // Ensure "Platform Admin" Role Exists (using ID from constants)
  await db
    .insert(schema.role)
    .values({
      id: REQUIRED_ADMIN_ROLE_ID,
      name: 'Platform Admin',
      isSystem: true,
      description: 'Super administrator for the platform',
    })
    .onConflictDoNothing();

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

  // Insert Member for System Tenant
  console.log('3️⃣  Assigning platform_admin role in System Tenant...');
  await db
    .insert(schema.member)
    .values({
      id: uuidv4(),
      userId: user.id, // Keeping user.id as adminUser is not defined in this context
      organizationId: REQUIRED_SYSTEM_TENANT_ID,
      roleId: REQUIRED_ADMIN_ROLE_ID, // Platform Admin Role
      createdAt: new Date(),
    })
    .onConflictDoNothing();

  console.log(
    `✅ User '${user.name}' (${user.email}) is now a MEMBER of System Tenant with 'Platform Admin' role.`,
  );

  console.log('\n--------- CREDENTIALS ---------');
  console.log(`URL:      http://localhost:5173/login`);
  console.log(`Email:    ${EMAIL}`);
  console.log(`Password: ********`);
  console.log('-------------------------------');

  await client.end();
}

void bootstrap();
