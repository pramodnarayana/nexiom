import { DatabaseManager, SchemaPlan, SqlDatabaseManager } from "@soopa/dbmanager";

export class MockDatabaseManager implements DatabaseManager {
    private sqlManager: SqlDatabaseManager;

    constructor(private readonly db: any) {
        this.sqlManager = new SqlDatabaseManager(db);
    }

    async getTenantDb(tenantId: string): Promise<any> {
        return this.db;
    }

    async applyPlan(tenantId: string, schemaName: string, plan: SchemaPlan, context?: { appName: string, appProfile: string }): Promise<void> {
        await this.sqlManager.applyPlan(schemaName, plan, context);
    }

    async migrateToStandardActive(tenantId: string, schemaName: string): Promise<void> {
        if (this.sqlManager.migrateToStandardActive) {
            await this.sqlManager.migrateToStandardActive(schemaName);
        }
    }
}
