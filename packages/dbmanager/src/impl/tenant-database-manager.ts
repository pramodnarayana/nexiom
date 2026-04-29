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
     * @param tenantId The organization ID
     */
    async getTenantDb(tenantId: string): Promise<DrizzleDb> {
        if (this.dbCache.has(tenantId)) {
            return this.dbCache.get(tenantId)!;
        }

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
        const baseUrl = databaseHostUrl.endsWith('/') ? databaseHostUrl.slice(0, -1) : databaseHostUrl;
        const fullUrl = `${baseUrl}/${databaseName}`;

        this.logger.debug(`Establishing new connection pool for tenant ${tenantId} at ${databaseName}`);
        
        const tenantDb = this.dbFactory(fullUrl);
        this.dbCache.set(tenantId, tenantDb);

        return tenantDb;
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
}
