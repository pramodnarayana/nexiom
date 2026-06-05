export interface IProcessRunner {
    dropAll(): Promise<void>;
    truncateAll(): Promise<void>;
    fresh(): Promise<void>;
    reset(): Promise<void>;
}

export interface IMigrationRunner {
    migrate(): void;
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
