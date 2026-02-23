import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as tenantSchema from './schema/tenant';
import * as appCredentialSchema from './schema/app-credential';

const schemaBundle = { ...tenantSchema, ...appCredentialSchema };
type DbSchema = typeof schemaBundle;

let pool: Pool | undefined;
let tempDbInstance: ReturnType<typeof drizzle> | undefined;

export type DrizzleDb = ReturnType<typeof drizzle<DbSchema>>;
let dbInstance: DrizzleDb | undefined;

export function getDb(): DrizzleDb {
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

    dbInstance = drizzle({ client: pool, schema: schemaBundle });
    // Drain the pool on graceful shutdown so in-flight queries finish cleanly.
    process.once('SIGTERM', () => pool!.end());
    process.once('SIGINT', () => pool!.end());
    return dbInstance;
}

// For backwards compatibility where `db` was used directly, we can define a proxy
// that initializes the DB on the first query.
export const db = new Proxy({} as NodePgDatabase<DbSchema>, {
    get(_target, prop) {
        return getDb()[prop as keyof NodePgDatabase<DbSchema>];
    }
});

