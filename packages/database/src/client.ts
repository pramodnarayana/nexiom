import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as identitySchema from './schema/global/identity.js';
import * as routingSchema from './schema/global/routing.js';
import * as registrySchema from './schema/global/storage_registry.js';
import * as profileSchema from './schema/global/connector_object_profiles.js';
import * as dataSourcesSchema from './schema/shared/data-sources.js';
import * as piecesSchema from './schema/global/pieces.js';
import * as workspaceSchema from './schema/shared/workspace.js';
import * as globalStitchesSchema from './schema/shared/stitches.js';
import * as tenantSyncCursorsSchema from './schema/tenant/sync-cursors.js';
import * as gemSchema from './schema/tenant/gem.js';
import * as pipelineSchema from './schema/tenant/pipeline.js';

const schemaBundle = {
    ...identitySchema,
    ...routingSchema,
    ...registrySchema,
    ...profileSchema,
    ...dataSourcesSchema,
    ...piecesSchema,
    ...workspaceSchema,
    ...globalStitchesSchema,
    ...tenantSyncCursorsSchema,
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
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
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
