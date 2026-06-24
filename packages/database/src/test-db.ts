import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
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
import type { DrizzleDb } from './client.js';

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

/**
 * A lightweight wrapper around a pg Pool + Drizzle instance for use in
 * integration tests. Call start() in beforeAll and stop() in afterAll.
 */
export class TestDatabaseManager {
    private pool: Pool | undefined;
    public db: DrizzleDb | undefined;

    async start(): Promise<void> {
        const connectionString =
            process.env.DATABASE_POOLED_URL ?? process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error(
                'DATABASE_URL environment variable is required for integration tests',
            );
        }

        this.pool = new Pool({
            connectionString,
            max: 5,
            idleTimeoutMillis: 10_000,
            connectionTimeoutMillis: 5_000,
        });

        this.db = drizzle({ client: this.pool, schema: schemaBundle }) as DrizzleDb;
    }

    async stop(): Promise<void> {
        if (this.pool) {
            try {
                await this.pool.end();
            } finally {
                this.pool = undefined;
                this.db = undefined;
            }
        }
    }

    /**
     * Creates a PostgreSQL schema with the given name if it doesn't already exist.
     * Useful in integration tests that spin up tenant schemas on the fly.
     */
    async createSchema(schemaName: string): Promise<void> {
        if (!this.db) throw new Error('TestDatabaseManager not started. Call start() first.');
        await this.db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(schemaName)}`);
    }
}
