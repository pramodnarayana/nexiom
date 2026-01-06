
import { Client } from 'pg';

const main = async () => {
    const connectionString = process.env.DATABASE_URL || 'postgres://admin:password123@localhost:5432/nexiom_master';
    console.log(`Checking DB: ${connectionString.replace(/:[^:]+@/, ':***@')}`); // Mask password
    const client = new Client({ connectionString });

    await client.connect();

    try {
        const userRes = await client.query('SELECT count(*) FROM "user";');
        console.log(`Users count: ${userRes.rows[0].count}`);

        const sessionRes = await client.query('SELECT count(*) FROM "session";');
        console.log(`Sessions count: ${sessionRes.rows[0].count}`);

        const orgRes = await client.query('SELECT count(*) FROM "organization";');
        console.log(`Organizations count: ${orgRes.rows[0].count}`);
    } catch (e) {
        console.error("Query failed:", e.message);
    }

    await client.end();
};

main().catch(console.error);
