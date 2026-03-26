import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SqlDatabaseManager } from './sql-database-manager.js';
import { SchemaPlan } from '../interfaces.js';

function makeDbMock() {
    const queryMock = vi.fn().mockResolvedValue(undefined);
    return {
        $client: { query: queryMock },
        _queryMock: queryMock,
    };
}

describe('SqlDatabaseManager', () => {
    let db: ReturnType<typeof makeDbMock>;
    let manager: SqlDatabaseManager;

    beforeEach(() => {
        vi.clearAllMocks();
        db = makeDbMock();
        manager = new SqlDatabaseManager(db as never);
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
    });

    it('GATEWAY_ACTIVE calls CREATE SCHEMA + gateway DDL', async () => {
        await manager.applyPlan('ws_test', SchemaPlan.GATEWAY_ACTIVE);

        // 1 CREATE SCHEMA + 4 gateway statements (table + 3 indexes)
        expect(db._queryMock).toHaveBeenCalledTimes(5);
        expect(db._queryMock.mock.calls[0][0]).toContain('CREATE SCHEMA IF NOT EXISTS');
        expect(db._queryMock.mock.calls[1][0]).toContain('inbound_gateway');
    });

    it('REPLICA_ACTIVE calls schema + gateway + replica DDL', async () => {
        await manager.applyPlan('ws_test', SchemaPlan.REPLICA_ACTIVE);

        // 1 schema + 4 gateway + 5 replica (2 tables + 3 indexes)
        expect(db._queryMock).toHaveBeenCalledTimes(10);
        const allSql = db._queryMock.mock.calls.map((c: any[]) => String(c[0])).join('\n');
        expect(allSql).toContain('inbound_gateway');
        expect(allSql).toContain('replica_entity');
        expect(allSql).toContain('sync_cursor');
    });

    it('NORMALIZE_ACTIVE calls schema + gateway + replica + normalize DDL', async () => {
        await manager.applyPlan('ws_test', SchemaPlan.NORMALIZE_ACTIVE);

        // 1 schema + 4 gateway + 5 replica + 5 normalize (1 table + 4 indexes)
        expect(db._queryMock).toHaveBeenCalledTimes(15);
        const allSql = db._queryMock.mock.calls.map((c: any[]) => String(c[0])).join('\n');
        expect(allSql).toContain('normalized_entity');
    });

    it('OUTBOUND_ACTIVE calls all five provisioning stages', async () => {
        await manager.applyPlan('ws_test', SchemaPlan.OUTBOUND_ACTIVE);

        const expectedStageCounts = {
            schema: 1,
            gateway: 4,
            replica: 5,
            normalize: 5,
            outbound: 8,
            total: 23
        };

        expect(db._queryMock).toHaveBeenCalledTimes(expectedStageCounts.total);
        const allSql = db._queryMock.mock.calls.map((c: any[]) => String(c[0])).join('\n');
        
        expect(allSql).toContain('inbound_gateway');
        expect(allSql).toContain('replica_entity');
        expect(allSql).toContain('sync_cursor');
        expect(allSql).toContain('normalized_entity');
        expect(allSql).toContain('outbound_gateway');
        expect(allSql).toContain('sync_log');
    });
});
