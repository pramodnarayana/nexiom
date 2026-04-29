import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as identitySchema from './schema/global/identity.js';
import * as tenantSchema from './schema/tenant/tenant.js';
import * as registrySchema from './schema/global/storage_registry.js';
import * as profileSchema from './schema/tenant/connector_object_profiles.js';
import * as piecesSchema from './schema/global/pieces.js';
import * as workspaceSchema from './schema/tenant/workspace.js';
import * as stitchesSchema from './schema/tenant/stitches.js';
import * as gemSchema from './schema/tenant/gem.js';
import * as pipelineSchema from './schema/tenant/pipeline.js';

const schemaBundle = {
    ...identitySchema,
    ...tenantSchema,
    ...registrySchema,
    ...profileSchema,
    ...piecesSchema,
    ...workspaceSchema,
    ...stitchesSchema,
    ...gemSchema,
    ...pipelineSchema,
};
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
    return dbInstance;
}

/**
 * Drains the pg connection pool.
 * Called by DatabaseModule.onModuleDestroy() so pool shutdown is coordinated
 * through app.close() rather than racing against OS signal handlers.
 */
export async function closeDb(): Promise<void> {
    if (pool) {
        try {
            await pool.end();
        } finally {
            pool = undefined;
            dbInstance = undefined;
        }
    }
}
