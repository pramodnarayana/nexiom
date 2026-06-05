export interface IProcessRunner {
    dropAll(): Promise<void>;
    truncateAll(): Promise<void>;
    fresh(): Promise<void>;
    reset(): Promise<void>;
}

/**
 * Interface for running database migrations.
 * Note: migrate() and migrateGlobal() return void because they perform synchronous/blocking work
 * and will throw synchronously on error.
 */
export interface IMigrationRunner {
    /**
     * Runs migrations synchronously. Throws on error.
     */
    migrate(): void;
    /**
     * Runs global migrations synchronously. Throws on error.
     */
    migrateGlobal(): void;
    createTenantDatabase(dbName: string, hostUrl: string): Promise<void>;
    migrateTenant(dbName: string, hostUrl: string): Promise<void>;
    migrateAllSchemas(): Promise<void>;
}

export interface ISeedService {
    seed(): Promise<void>;
    seedAbac(): Promise<void>;
    provisionLocal(): Promise<void>;
    provisionGateway(schemaName: string): Promise<void>;
    provisionOutbound(schemaName: string): Promise<void>;
    seedMapping(): Promise<void>;
    checkUserPermissions(identifier: string): Promise<void>;
    debugPermissions(roleName: string): Promise<void>;
}
