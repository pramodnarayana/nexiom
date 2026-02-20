// Placeholder for Drizzle Client
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nexiom',
});

// @ts-ignore
export const db = drizzle(pool);
