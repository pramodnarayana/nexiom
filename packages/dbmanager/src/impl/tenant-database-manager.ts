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
 * A function that injects runtime credentials into a credential-less host URL.
 * Implements the principle of separation of topology from auth:
 *   - The registry stores WHERE the database lives (host:port)
 *   - Credentials are resolved at runtime from env vars or a secrets manager
 *
 * Supports both sync and async resolution for flexibility (e.g., AWS Secrets Manager).
 *
 * @example
 *   // Reads from DATABASE_URL at connection time — never from the registry
 *   (hostUrl) => hostUrl.replace('postgres://', `postgres://user:password@`)
 */
export type CredentialResolver = (hostUrl: string) => string | Promise<string>;

/**
 * Enterprise implementation of DatabaseManager that dynamically resolves
 * physical database connections based on the Tenant ID using the Global Database's
 * tenant_storage_registry.
 *
 * Design principles:
 *   - The registry stores data topology (host, database name) — never credentials.
 *   - Auth is injected at connection time via a `credentialResolver`, which can
 *     pull from env vars, AWS Secrets Manager, Vault, etc.
 *   - Connection pools are cached per-tenant and deduplicated under concurrent load.
 */
export class TenantDatabaseManager implements DatabaseManager {
    private readonly logger: Logger;
    private readonly dbCache = new Map<string, DrizzleDb>();
    private readonly inProgress = new Map<string, Promise<DrizzleDb>>();

    constructor(
        private readonly globalDb: DrizzleDb,
        private readonly dbFactory: (connectionString: string) => DrizzleDb,
        private readonly domainProvisionerResolver?: (appName: string, appProfile: string) => ((db: DrizzleDb, schemaName: string) => Promise<void>) | undefined,
        logger?: Logger,
        /** Resolves credentials for a given credential-less host URL at connection time. */
        private readonly credentialResolver?: CredentialResolver,
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

                // Validate and sanitize databaseName for safe URL paths.
                const sanitizedDbName = databaseName.trim().replace(/^\/+|\/+$/g, '');
                if (!/^[a-zA-Z0-9_-]+$/.test(sanitizedDbName)) {
                    throw new Error(
                        `[TenantDatabaseManager] Invalid databaseName "${databaseName}" for tenant ${tenantId}. ` +
                        `Only alphanumeric, underscore, and hyphen characters are allowed.`
                    );
                }

                // Inject credentials at connection time via the resolver.
                // The registry stores only the host (no credentials) — this is
                // the enterprise pattern: topology in the DB, auth from a secrets source.
                const resolvedHostUrl = this.credentialResolver
                    ? await this.credentialResolver(databaseHostUrl)
                    : databaseHostUrl;

                // Construct URL safely using URL object
                const url = new URL(resolvedHostUrl);
                // Append database name to pathname, properly encoded
                url.pathname = url.pathname.replace(/\/$/, '') + '/' + encodeURIComponent(sanitizedDbName);
                const fullUrl = url.toString();

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
        // First, await any in-progress getTenantDb promises to ensure they complete
        const inProgressPromises = Array.from(this.inProgress.values());
        if (inProgressPromises.length > 0) {
            this.logger.debug(`Awaiting ${inProgressPromises.length} in-progress tenant connection creations`);
            await Promise.allSettled(inProgressPromises);
        }

        // Now close all cached connections (including any newly created by the in-progress promises)
        const tenantIds = Array.from(this.dbCache.keys());
        this.logger.debug(`Closing ${tenantIds.length} cached tenant connections`);

        await Promise.allSettled(
            tenantIds.map(tenantId => this.closeTenantDb(tenantId))
        );

        this.dbCache.clear();
        this.inProgress.clear();
        this.logger.debug('All tenant connections closed');
    }
}
