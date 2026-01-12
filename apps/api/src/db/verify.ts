import { Client } from 'pg';

const main = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined');
  }
  const connectionString = process.env.DATABASE_URL;
  console.log(`Checking DB: ${connectionString.replace(/:[^:]+@/, ':***@')}`); // Mask password
  const client = new Client({ connectionString });

  await client.connect();

  try {
    const userRes = await client.query('SELECT count(*) FROM "user";');
    const userRows = userRes.rows as { count: string }[];
    console.log(`Users count: ${userRows[0].count}`);

    const sessionRes = await client.query('SELECT count(*) FROM "session";');
    const sessionRows = sessionRes.rows as { count: string }[];
    console.log(`Sessions count: ${sessionRows[0].count}`);

    const orgRes = await client.query('SELECT count(*) FROM "organization";');
    const orgRows = orgRes.rows as { count: string }[];
    console.log(`Organizations count: ${orgRows[0].count}`);
  } catch (e) {
    if (e instanceof Error) {
      console.error('Query failed:', e.message);
    } else {
      console.error('Query failed:', String(e));
    }
  }

  await client.end();
};

main().catch(console.error);
