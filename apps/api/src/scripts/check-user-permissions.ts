import 'reflect-metadata';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../../../packages/identity/src/schema';
import { eq } from 'drizzle-orm';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Force load env from api root
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  // List first 10 users to see who is in the DB
  const users = await db.query.user.findMany({
    limit: 10,
  });

  console.log(
    'Found users:',
    users.map((u) => ({ id: u.id, email: u.email, role: u.role })),
  );

  if (users.length === 0) {
    console.log('No users found in database.');
    await pool.end();
    return;
  }

  // Pick the first one or the one matching the arg
  const targetEmail = process.argv[2] || users[0].email;
  const user = users.find((u) => u.email === targetEmail) || users[0];

  console.log(`Checking permissions for: ${user.email} (${user.id})`);

  console.log('User Record:', {
    id: user.id,
    email: user.email,
    role: user.role, // This checks the global 'admin' flag
  });

  const members = await db.query.member.findMany({
    where: eq(schema.member.userId, user.id),
    with: {
      organization: true,
    },
  });

  console.log(
    'Memberships:',
    members.map((m) => ({
      orgId: m.organizationId,
      orgName: m.organization ? m.organization.name : 'Unknown',
      role: m.role,
    })),
  );

  const hasAdminMembership = members.some(
    (m) => m.role === 'admin' || m.role === 'owner',
  );
  console.log('Has Admin/Owner Membership?', hasAdminMembership);

  await pool.end();
}

main().catch(console.error);
