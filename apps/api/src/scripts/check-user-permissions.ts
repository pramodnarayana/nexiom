import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../../../packages/identity/src/schema';
import { eq } from 'drizzle-orm';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

// Force load env from api root
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  try {
    const db = drizzle(pool, { schema });

    // List first 10 users to see who is in the DB
    const users = await db.query.user.findMany({
      limit: 10,
    });

    console.log(
      'All users in DB (masked):',
      users.map((u) => ({
        id: u.id,
        email: u.email.replace(/(^[^@]{2})[^@]*(@.*$)/, '$1***$2'),
        role: u.role,
      })),
    );

    const targetEmail = process.argv[2];
    let user;

    if (targetEmail) {
      console.log(`Looking up user by email: ${targetEmail}`);
      user = await db.query.user.findFirst({
        where: eq(schema.user.email, targetEmail),
      });

      if (!user) {
        throw new Error(`User with email "${targetEmail}" not found.`);
      }
    } else {
      if (users.length === 0) {
        console.log('No users found in database.');
        return;
      }
      console.log('No email argument provided, defaulting to first user.');
      user = users[0];
    }

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
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
