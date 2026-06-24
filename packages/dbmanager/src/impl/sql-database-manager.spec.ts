import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SqlDatabaseManager } from './sql-database-manager.js';
import { SchemaPlan } from '../interfaces.js';

function makeDbMock() {
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    return {
        $client: { query: queryMock },
        _queryMock: queryMock,
    };
}

describe('SqlDatabaseManager', () => {
    let db: ReturnType<typeof makeDbMock>;
    let migratorMock: any;
    let manager: SqlDatabaseManager;

    beforeEach(() => {
        vi.clearAllMocks();
        db = makeDbMock();
        migratorMock = {
            runMigrations: vi.fn().mockResolvedValue(undefined),
        };
        manager = new SqlDatabaseManager(db as never, migratorMock);
    });

    // ── Schema name validation ────────────────────────────────────────────

    it('throws on invalid schemaName (SQL injection attempt)', async () => {
        await expect(
            manager.applyPlan("'; DROP TABLE users; --", SchemaPlan.NAMESPACE_ONLY),
        ).rejects.toThrow(/Invalid schemaName/);
        expect(db._queryMock).not.toHaveBeenCalled();
    });

    it('accepts valid schemaName ws_abc_123', async () => {
        await expect(
            manager.applyPlan('ws_abc_123', SchemaPlan.NAMESPACE_ONLY),
        ).resolves.toBeUndefined();
        expect(db._queryMock).toHaveBeenCalled();
    });

    // ── Plan cascade ──────────────────────────────────────────────────────

    it('NAMESPACE_ONLY calls only CREATE SCHEMA', async () => {
        await manager.applyPlan('ws_test', SchemaPlan.NAMESPACE_ONLY);

        expect(db._queryMock).toHaveBeenCalledTimes(1);
        expect(db._queryMock.mock.calls[0][0]).toContain('CREATE SCHEMA IF NOT EXISTS');
        expect(migratorMock.runMigrations).not.toHaveBeenCalled();
    });

    it('SCHEMA_ACTIVE calls CREATE SCHEMA and then runs pipeline migrations', async () => {
        await manager.applyPlan('ws_test', SchemaPlan.SCHEMA_ACTIVE);

        expect(db._queryMock).toHaveBeenCalledTimes(1);
        expect(db._queryMock.mock.calls[0][0]).toContain('CREATE SCHEMA IF NOT EXISTS');

        expect(migratorMock.runMigrations).toHaveBeenCalledTimes(1);
        expect(migratorMock.runMigrations).toHaveBeenCalledWith(db, expect.objectContaining({
            searchPath: 'ws_test',
        }));
        
        const migrationsFolder = migratorMock.runMigrations.mock.calls[0][1].migrationsFolder;
        expect(migrationsFolder).toContain('drizzle/pipeline');
    });

    it('migrateToStandardActive applies pipeline migrations', async () => {
        await manager.migrateToStandardActive('ws_test');
        
        expect(db._queryMock).not.toHaveBeenCalled();
        expect(migratorMock.runMigrations).toHaveBeenCalledTimes(1);
        expect(migratorMock.runMigrations).toHaveBeenCalledWith(db, expect.objectContaining({
            searchPath: 'ws_test',
        }));
    });
});