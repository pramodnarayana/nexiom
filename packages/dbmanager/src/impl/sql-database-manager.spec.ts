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

    it('STANDARD_ACTIVE calls CREATE SCHEMA + gateway DDL', async () => {
        await manager.applyPlan('ws_test', SchemaPlan.STANDARD_ACTIVE);

        // 1 CREATE SCHEMA + 3 rename checks + 4 inbound_gateway (CREATE TABLE + RENAME + 2 ADD COLUMN)
        // + 3 indexes (ext_id, object_type, status) + DROP idx_l1_payload_gin + CREATE idx_l1_request_gin
        // + inbound_outbox (CREATE TABLE + RENAME last_error + idx_inbound_outbox_claim + UNIQUE constraint DO block)
        // + active_sync_locks (CREATE TABLE)
        // + sync_log (CREATE TABLE + DROP legacy constraint + ALTER+CREATE uq_routed + CREATE uq_unrouted)
        // + 3 sync_log indexes (trace, route, trace_layer)
        // = 1 + 3 + 4 + 5 + 4 + 1 + 6 = 24 — but let's just count from the code
        const count = db._queryMock.mock.calls.length;
        // Assert at least the key tables are in the SQL
        const allSql = db._queryMock.mock.calls.map((c: any[]) => String(c[0])).join('\n');
        expect(allSql).toContain('CREATE SCHEMA IF NOT EXISTS');
        expect(allSql).toContain('inbound_gateway');
        expect(allSql).toContain('inbound_outbox');
        expect(allSql).toContain('active_sync_locks');
        expect(allSql).toContain('sync_log');
        expect(allSql).toContain('idx_inbound_outbox_claim');
        expect(allSql).toContain('idx_inbound_outbox_trace');
        // Snapshot the count to catch unintentional DDL additions
        expect(count).toMatchSnapshot('STANDARD_ACTIVE DDL count');
    });

    it('STANDARD_ACTIVE calls schema + gateway + replica DDL', async () => {
        await manager.applyPlan('ws_test', SchemaPlan.STANDARD_ACTIVE);

        const allSql = db._queryMock.mock.calls.map((c: any[]) => String(c[0])).join('\n');
        expect(allSql).toContain('inbound_gateway');
        expect(allSql).toContain('replica_entity');
        expect(allSql).toContain('sync_cursor');
        expect(allSql).toContain('replica_outbox');
        expect(db._queryMock.mock.calls.length).toMatchSnapshot('STANDARD_ACTIVE DDL count');
    });

    it('STANDARD_ACTIVE calls schema + gateway + replica + normalize DDL', async () => {
        await manager.applyPlan('ws_test', SchemaPlan.STANDARD_ACTIVE);

        const allSql = db._queryMock.mock.calls.map((c: any[]) => String(c[0])).join('\n');
        expect(allSql).toContain('normalized_entity');
        expect(allSql).toContain('normalized_outbox');
        expect(db._queryMock.mock.calls.length).toMatchSnapshot('STANDARD_ACTIVE DDL count');
    });

    it('STANDARD_ACTIVE calls all five provisioning stages', async () => {
        await manager.applyPlan('ws_test', SchemaPlan.STANDARD_ACTIVE, { appName: 'test', appProfile: 'test' });

        const allSql = db._queryMock.mock.calls.map((c: any[]) => String(c[0])).join('\n');

        expect(allSql).toContain('inbound_gateway');
        expect(allSql).toContain('inbound_outbox');
        expect(allSql).toContain('replica_entity');
        expect(allSql).toContain('sync_cursor');
        expect(allSql).toContain('normalized_entity');
        expect(allSql).toContain('normalized_outbox');
        expect(allSql).toContain('outbound_gateway');
        expect(allSql).toContain('sync_log');
        expect(allSql).toContain('replica_outbox');
        expect(allSql).toContain('outbound_outbox');
        expect(allSql).toContain('attempts');
        expect(db._queryMock.mock.calls.length).toMatchSnapshot('STANDARD_ACTIVE DDL count');
    });
});