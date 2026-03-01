import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as tenantSchema from './schema/tenant';
import * as registrySchema from './schema/storage_registry';

const schemaBundle = { ...tenantSchema, ...registrySchema };
type DbSchema = typeof schemaBundle;

let pool: Pool | undefined;

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



