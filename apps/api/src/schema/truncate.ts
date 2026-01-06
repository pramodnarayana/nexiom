import { Client } from 'pg';

const main = async () => {
    const connectionString = process.env.DATABASE_URL || 'postgres://admin:password123@localhost:5432/nexiom_master';
    const client = new Client({ connectionString });

    await client.connect();

    console.log('Truncating tables...');

    // Better Auth tables
    const tables = ['user', 'session', 'account', 'verification', 'organization', 'member'];

    for (const table of tables) {
        try {
            await client.query(`TRUNCATE TABLE "${table}" CASCADE;`);
        } catch (e) {
            console.log(`Skipped ${table} (maybe doesn't exist)`);
        }
    }

    console.log('Done.');
    await client.end();
};

main().catch(console.error);
