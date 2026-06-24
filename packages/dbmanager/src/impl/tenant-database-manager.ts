import type { DatabaseManager } from '../interfaces.js';
import { SchemaPlan } from '../interfaces.js';
import type { DrizzleDb } from '@soopa/database';
import { tenantStorageRegistry, shardRegistry, organization } from '@soopa/database';
import { eq, sql } from 'drizzle-orm';
import { SqlDatabaseManager } from './sql-database-manager.js';
import type { MigrationRunnerPort } from '@soopa/migrator';

interface Logger {
    debug(msg: string, ...args: unknown[]): void;
    info?(msg: string, ...args: unknown[]): void;
    warn?(msg: string, ...args: unknown[]): void;
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
    private readonly urlCache = new Map<string, string>();

    constructor(
        private readonly globalDb: DrizzleDb,
        private readonly dbFactory: (connectionString: string) => DrizzleDb,
        private readonly migrator: MigrationRunnerPort,
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
                let registryInfo = await this.globalDb
                    .select()
                    .from(tenantStorageRegistry)
                    .where(eq(tenantStorageRegistry.tenantId, tenantId))
                    .limit(1);

                if (registryInfo.length === 0) {
                    this.logger.debug(`No active database found for tenant ${tenantId}. Determining routing tier...`);
                    
                    // 1. Fetch organization tier
                    const orgInfo = await this.globalDb
                        .select({ metadata: organization.metadata })
                        .from(organization)
                        .where(eq(organization.id, tenantId))
                        .limit(1);

                    let isEnterprise = false;
                    if (orgInfo.length > 0 && orgInfo[0].metadata) {
                        try {
                            const metadataObj = typeof orgInfo[0].metadata === 'string' ? JSON.parse(orgInfo[0].metadata) : orgInfo[0].metadata;
                            if (metadataObj.tier === 'enterprise') {
                                isEnterprise = true;
                            }
                        } catch (e) {
                            // Log parse errors for visibility
                            this.logger.warn?.(
                                `Failed to parse organization metadata for tenant ${tenantId}: ${e instanceof Error ? e.message : String(e)}`
                            );
                        }
                    }

                    if (isEnterprise) {
                        this.logger.debug(`Tenant ${tenantId} is ENTERPRISE tier. Claiming from warm pool...`);
                        await this.globalDb.execute(sql`
                            UPDATE tenant_storage_registry
                            SET tenant_id = ${tenantId}, status = 'ACTIVE', updated_at = NOW()
                            WHERE tenant_id = (
                                SELECT tenant_id FROM tenant_storage_registry
                                WHERE status = 'WARM'
                                  AND NOT EXISTS (
                                      SELECT 1 FROM tenant_storage_registry
                                      WHERE tenant_id = ${tenantId} AND status = 'ACTIVE'
                                  )
                                LIMIT 1
                                FOR UPDATE SKIP LOCKED
                            )
                        `);
                    } else {
                        this.logger.debug(`Tenant ${tenantId} is STANDARD tier. Assigning to a shard...`);
                        
                        // JIT Provisioning for Standard Shards: Find least loaded shard
                        await this.globalDb.execute(sql`
                            WITH selected_shard AS (
                                SELECT id, database_name, database_host_url, region_context
                                FROM shard_registry
                                WHERE status = 'ACTIVE' AND current_tenants < max_tenants
                                ORDER BY current_tenants ASC
                                LIMIT 1
                            )
                            INSERT INTO tenant_storage_registry (tenant_id, database_name, database_host_url, region_context, status, created_at, updated_at)
                            SELECT ${tenantId}, database_name, database_host_url, region_context, 'ACTIVE', NOW(), NOW()
                            FROM selected_shard
                            ON CONFLICT (tenant_id) DO NOTHING
                        `);

                        // Increment shard tenant count
                        await this.globalDb.execute(sql`
                            UPDATE shard_registry
                            SET current_tenants = current_tenants + 1
                            WHERE database_name = (
                                SELECT database_name FROM tenant_storage_registry WHERE tenant_id = ${tenantId}
                            )
                        `);
                    }
                    
                    // Re-query to get the assigned DB
                    registryInfo = await this.globalDb
                        .select()
                        .from(tenantStorageRegistry)
                        .where(eq(tenantStorageRegistry.tenantId, tenantId))
                        .limit(1);
                        
                    if (registryInfo.length === 0) {
                        throw new Error(
                            `[TenantDatabaseManager] Failed to assign tenant ${tenantId}. ` +
                            (isEnterprise ? `Ensure the warm pool has available capacity.` : `Ensure there is an active shard available.`)
                        );
                    }
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
                this.urlCache.set(tenantId, fullUrl);

                return tenantDb;
            } finally {
                // Clean up in-progress Promise regardless of success or failure
                this.inProgress.delete(tenantId);
            }
        })();

        this.inProgress.set(tenantId, creationPromise);
        return creationPromise;
    }

    private async withSchemaLock<T>(tenantDb: DrizzleDb, schemaName: string, fn: () => Promise<T>): Promise<T> {
        const db = tenantDb as any;
        let lockClient: any = null;
        
        // Generate a 32-bit positive integer lock ID from the schema name
        const lockId = Array.from(schemaName).reduce((hash, char) => {
            return (hash << 5) - hash + char.charCodeAt(0);
        }, 0) & 0x7FFFFFFF;

        try {
            if (db.$client?.connect) {
                this.logger.debug(`Acquiring advisory lock for schema provisioning: ${schemaName}`);
                lockClient = await db.$client.connect();
                await lockClient.query(`SELECT pg_advisory_lock(${lockId})`);
            }
            return await fn();
        } finally {
            if (lockClient) {
                try {
                    await lockClient.query(`SELECT pg_advisory_unlock(${lockId})`);
                } catch (unlockErr) {
                    this.logger.warn?.(`Failed to unlock advisory lock for schema ${schemaName}: ${unlockErr instanceof Error ? unlockErr.message : String(unlockErr)}`);
                } finally {
                    lockClient.release();
                    this.logger.debug(`Released advisory lock for schema: ${schemaName}`);
                }
            }
        }
    }

    /**
     * Executes a callback using a dedicated, single-use database connection.
     * Guarantees that DDL operations (like schema creation) do not taint the
     * main application's connection pool with sticky `search_path` state.
     */
    private async runWithDedicatedMigrationConnection<T>(
        tenantId: string,
        schemaName: string,
        fn: (sqlManager: SqlDatabaseManager) => Promise<T>
    ): Promise<T> {
        // Ensure the tenant DB is initialized and URL is cached
        const tenantDb = await this.getTenantDb(tenantId);
        const fullUrl = this.urlCache.get(tenantId);
        
        if (!fullUrl) {
            throw new Error(`[TenantDatabaseManager] URL cache miss for tenant ${tenantId}`);
        }

        this.logger.debug(`Spawning dedicated migration connection for tenant ${tenantId}`);
        // Create a completely separate instance (and pool) for the migration
        const dedicatedDb = this.dbFactory(fullUrl);
        const sqlManager = new SqlDatabaseManager(dedicatedDb, this.migrator, this.logger);
        
        return await this.withSchemaLock(tenantDb, schemaName, async () => {
            try {
                return await fn(sqlManager);
            } finally {
                // Permanently destroy the dedicated connection/pool to prevent leakage
                const db = dedicatedDb as unknown as { $client?: { end: () => Promise<void> }; end?: () => Promise<void> };
                if (typeof db.$client?.end === 'function') {
                    await db.$client.end();
                } else if (typeof db.end === 'function') {
                    await db.end();
                }
            }
        });
    }

    /**
     * Idempotently bring the schema up to the desired plan level.
     */
    async applyPlan(tenantId: string, schemaName: string, plan: SchemaPlan): Promise<void> {
        await this.runWithDedicatedMigrationConnection(tenantId, schemaName, async (sqlManager) => {
            await sqlManager.applyPlan(schemaName, plan);
        });
    }

    /**
     * Migrates an existing tenant schema to SCHEMA_ACTIVE state.
     */
    async migrateToStandardActive(tenantId: string, schemaName: string): Promise<void> {
        await this.runWithDedicatedMigrationConnection(tenantId, schemaName, async (sqlManager) => {
            await sqlManager.migrateToStandardActive(schemaName);
        });
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
            const db = tenantDb as unknown as { $client?: { end: () => Promise<void> }; end?: () => Promise<void> };
            if (typeof db.$client?.end === 'function') {
                await db.$client.end();
            } else if (typeof db.end === 'function') {
                await db.end();
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
