import { DatabaseManager, SchemaPlan, SqlDatabaseManager } from "@soopa/dbmanager";

export class MockDatabaseManager implements DatabaseManager {
    private sqlManager: SqlDatabaseManager;

    constructor(private readonly db: unknown) {
        const migratorMock = {
            runMigrations: async () => {},
        } as any;
        this.sqlManager = new SqlDatabaseManager(db as any, migratorMock);
    }

    async getTenantDb(tenantId: string): Promise<any> {
        return this.db;
    }

    async applyPlan(tenantId: string, schemaName: string, plan: SchemaPlan): Promise<void> {
        await this.sqlManager.applyPlan(schemaName, plan);
    }

    async migrateToStandardActive(tenantId: string, schemaName: string): Promise<void> {
        await this.sqlManager.migrateToStandardActive(schemaName);
    }
}
