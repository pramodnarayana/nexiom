import type { DatabaseManager } from '../interfaces.js';
import { SchemaPlan } from '../interfaces.js';
import type { DrizzleDb } from '@soopa/database';
import { createHash } from 'node:crypto';
import { getWorkspaceSchemaName } from '../schema-utils.js';
import type { MigrationRunnerPort } from '@soopa/migrator';
import { createRequire } from 'node:module';
import path from 'node:path';

const SAFE_SCHEMA_NAME_RE = /^ws_[a-z0-9_]+$/;

interface Logger {
    debug(msg: string, ...args: unknown[]): void;
    info?(msg: string, ...args: unknown[]): void;
    error?(msg: string, ...args: unknown[]): void;
}

export class SqlDatabaseManager {
    private readonly logger: Logger;

    constructor(
        private readonly db: DrizzleDb,
        private readonly migrator: MigrationRunnerPort,
        logger?: Logger,
    ) {
        this.logger = logger ?? {
            debug: (msg: string, ...args: unknown[]) => {
                if (process.env.NODE_ENV !== 'production') {
                    console.debug(`[SqlDatabaseManager] ${msg}`, ...args);
                }
            }
        };
    }

    private validateSchemaName(name: string): void {
        if (!SAFE_SCHEMA_NAME_RE.test(name)) {
            throw new Error(
                `Invalid schemaName (sha256 prefix: ${createHash('sha256').update(name).digest('hex').slice(0, 8)}…) — ` +
                `expected format: ws_{workspaceId} with only lowercase letters, digits, and underscores after the prefix.`,
            );
        }
    }

    async applyPlan(schemaName: string, plan: SchemaPlan): Promise<void> {
        this.validateSchemaName(schemaName);

        type ProvisioningTask = 'namespace' | 'pipeline';

        const PLAN_TASKS: Record<SchemaPlan, ProvisioningTask[]> = {
            [SchemaPlan.NAMESPACE_ONLY]: ['namespace'],
            [SchemaPlan.SCHEMA_ACTIVE]: ['namespace', 'pipeline'],
        };

        const tasks = PLAN_TASKS[plan];
        if (!tasks) {
            throw new Error(`Unknown SchemaPlan: ${plan}`);
        }

        for (const task of tasks) {
            switch (task) {
                case 'namespace':
                    await this.db.$client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`);
                    break;
                case 'pipeline':
                    await this.provisionPipelineTables(schemaName);
                    break;
            }
        }
    }

    /**
     * Re-runs provisionPipelineTables on an existing schema.
     */
    async migrateReplicaTables(schemaName: string): Promise<void> {
        this.validateSchemaName(schemaName);
        await this.provisionPipelineTables(schemaName);
    }

    /**
     * Migrates an existing tenant schema to SCHEMA_ACTIVE state.
     */
    async migrateToStandardActive(schemaName: string): Promise<void> {
        this.validateSchemaName(schemaName);
        await this.provisionPipelineTables(schemaName);
    }

    private async provisionPipelineTables(schemaName: string): Promise<void> {
        const require = createRequire(import.meta.url);
        const dbPackagePath = path.dirname(require.resolve('@soopa/database/package.json'));
        const migrationsFolder = path.join(dbPackagePath, 'drizzle/pipeline');

        await this.migrator.runMigrations(this.db, {
            migrationsFolder,
            searchPath: schemaName,
        });
    }
}