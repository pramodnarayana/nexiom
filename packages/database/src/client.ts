import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as tenantSchema from './schema/tenant.js';
import * as registrySchema from './schema/storage_registry.js';
import * as profileSchema from './schema/connector_object_profiles.js';
import * as piecesSchema from './schema/pieces.js';

const schemaBundle = { ...tenantSchema, ...registrySchema, ...profileSchema, ...piecesSchema };
type DbSchema = typeof schemaBundle;

let pool: Pool | undefined;

export type DrizzleDb = ReturnType<typeof drizzle<DbSchema>>;
let dbInstance: DrizzleDb | undefined;

export function getDb(): DrizzleDb {
    if (dbInstance) return dbInstance;

    const connectionString = process.env.DATABASE_POOLED_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL environment variable is required');
    }

    pool = new Pool({
        connectionString,
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



