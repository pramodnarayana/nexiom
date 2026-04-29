import type { DatabaseManager } from '../interfaces.js';
import { SchemaPlan } from '../interfaces.js';
import type { DrizzleDb } from '@nexiom/database';
import { tenantStorageRegistry } from '@nexiom/database';
import { eq } from 'drizzle-orm';
import { SqlDatabaseManager } from './sql-database-manager.js';

interface Logger {
    debug(msg: string, ...args: unknown[]): void;
    info?(msg: string, ...args: unknown[]): void;
    error?(msg: string, ...args: unknown[]): void;
}

/**
 * Enterprise implementation of DatabaseManager that dynamically resolves
 * physical database connections based on the Tenant ID using the Global Database's
 * tenant_storage_registry.
 */
export class TenantDatabaseManager implements DatabaseManager {
    private readonly logger: Logger;
    private readonly dbCache = new Map<string, DrizzleDb>();
    private readonly inProgress = new Map<string, Promise<DrizzleDb>>();

    constructor(
        private readonly globalDb: DrizzleDb,
        private readonly dbFactory: (connectionString: string) => DrizzleDb,
        private readonly domainProvisionerResolver?: (appName: string) => ((db: DrizzleDb, schemaName: string) => Promise<void>) | undefined,
        logger?: Logger,
    ) {
        this.logger = logger ?? {
            debug: (msg: string, ...args: unknown[]) => {
                if (process.env.NODE_ENV !== 'production') {
                    console.debug(`[TenantDatabaseManager] ${msg}`, ...args);
                }
            }
        };
    }

    /**
     * Resolves and caches a physical database connection for a specific tenant.
     * Prevents race conditions by deduplicating concurrent creation requests.
     * @param tenantId The organization ID
     */
    async getTenantDb(tenantId: string): Promise<DrizzleDb> {
        // Return cached instance if already created
        if (this.dbCache.has(tenantId)) {
            return this.dbCache.get(tenantId)!;
        }

        // Return in-progress Promise if another caller is already creating this connection
        if (this.inProgress.has(tenantId)) {
            return this.inProgress.get(tenantId)!;
        }

        // Start creation and store the Promise
        const creationPromise = (async () => {
            try {
                const registryInfo = await this.globalDb
                    .select()
                    .from(tenantStorageRegistry)
                    .where(eq(tenantStorageRegistry.tenantId, tenantId))
                    .limit(1);

                if (registryInfo.length === 0) {
                    throw new Error(`[TenantDatabaseManager] No physical database found in registry for tenant ${tenantId}`);
                }

                const { databaseName, databaseHostUrl } = registryInfo[0];

                // Construct the full connection string.
                // In local development, databaseHostUrl will be the base URL (e.g., postgres://postgres:postgres@localhost:5432)
                // and databaseName will be 'db_tenant_uuid'.
                // We ensure a valid Postgres URL is formed by combining them properly.

                // Validate and sanitize databaseName for safe URL paths
                const sanitizedDbName = databaseName.trim().replace(/^\/+|\/+$/g, '');
                if (!/^[a-zA-Z0-9_-]+$/.test(sanitizedDbName)) {
                    throw new Error(
                        `[TenantDatabaseManager] Invalid databaseName "${databaseName}" for tenant ${tenantId}. ` +
                        `Only alphanumeric, underscore, and hyphen characters are allowed.`
                    );
                }

                const baseUrl = databaseHostUrl.endsWith('/') ? databaseHostUrl.slice(0, -1) : databaseHostUrl;
                const fullUrl = `${baseUrl}/${encodeURIComponent(sanitizedDbName)}`;

                this.logger.debug(`Establishing new connection pool for tenant ${tenantId} at ${databaseName}`);

                const tenantDb = this.dbFactory(fullUrl);
                this.dbCache.set(tenantId, tenantDb);

                return tenantDb;
            } finally {
                // Clean up in-progress Promise regardless of success or failure
                this.inProgress.delete(tenantId);
            }
        })();

        this.inProgress.set(tenantId, creationPromise);
        return creationPromise;
    }

    /**
     * Idempotently bring the schema up to the desired plan level.
     */
    async applyPlan(tenantId: string, schemaName: string, plan: SchemaPlan): Promise<void> {
        const tenantDb = await this.getTenantDb(tenantId);
        const sqlManager = new SqlDatabaseManager(tenantDb, this.logger, this.domainProvisionerResolver);
        await sqlManager.applyPlan(schemaName, plan);
    }

    /**
     * Migrates an existing tenant schema to OUTBOUND_ACTIVE state.
     */
    async migrateToOutboundActive(tenantId: string, schemaName: string): Promise<void> {
        const tenantDb = await this.getTenantDb(tenantId);
        const sqlManager = new SqlDatabaseManager(tenantDb, this.logger, this.domainProvisionerResolver);
        await sqlManager.migrateToOutboundActive(schemaName);
    }

    /**
     * Closes the connection pool for a specific tenant.
     * @param tenantId The organization ID
     */
    async closeTenantDb(tenantId: string): Promise<void> {
        const tenantDb = this.dbCache.get(tenantId);
        if (!tenantDb) {
            this.logger.debug(`No cached connection to close for tenant ${tenantId}`);
            return;
        }

        try {
            // Call the Drizzle/connection-pool shutdown method
            // Drizzle's pg adapter exposes .$pool or similar; adapt as needed
            if (typeof (tenantDb as any).$client?.end === 'function') {
                await (tenantDb as any).$client.end();
            } else if (typeof (tenantDb as any).end === 'function') {
                await (tenantDb as any).end();
            }
            this.logger.debug(`Closed connection pool for tenant ${tenantId}`);
        } catch (err) {
            this.logger.debug(`Error closing tenant connection for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            this.dbCache.delete(tenantId);
        }
    }

    /**
     * Closes all cached tenant connections for graceful shutdown.
     */
    async closeAll(): Promise<void> {
        const tenantIds = Array.from(this.dbCache.keys());
        this.logger.debug(`Closing ${tenantIds.length} cached tenant connections`);

        await Promise.allSettled(
            tenantIds.map(tenantId => this.closeTenantDb(tenantId))
        );

        this.dbCache.clear();
        this.logger.debug('All tenant connections closed');
    }
}
