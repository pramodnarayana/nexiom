import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as tenantSchema from './schema/tenant';
import * as providerSchema from './schema/provider';

let pool: Pool | undefined;
let dbInstance: ReturnType<typeof drizzle> | undefined;

export function getDb() {
    if (dbInstance) return dbInstance;

    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL environment variable is required');
    }

    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 20,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
    });

    dbInstance = drizzle({ client: pool, schema: { ...tenantSchema, ...providerSchema } });
    return dbInstance;
}

// For backwards compatibility where `db` was used directly, we can define a proxy
// that initializes the DB on the first query.
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
    get(_target, prop) {
        return getDb()[prop as keyof ReturnType<typeof drizzle>];
    }
});

