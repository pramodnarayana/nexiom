import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../../packages/identity/src/schema';

async function main() {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      'postgres://user:password@localhost:5432/nexiom_local',
  });
  const db = drizzle(pool, { schema });

  console.log('--- Invitations ---');
  const invs = await db.query.invitation.findMany();

  for (const inv of invs) {
    console.log({
      id: inv.id,
      email: inv.email,
      status: inv.status,
      expiresAt: inv.expiresAt,
      isExpired: new Date() > inv.expiresAt,
      now: new Date(),
    });
  }

  // We expect supportuser3 to be 'pending' if setPassword failed before accept.
  // If it is 'accepted', it means the transaction logic in controller didn't rollback properly or something else happened.

  await pool.end();
}

main().catch(console.error);
