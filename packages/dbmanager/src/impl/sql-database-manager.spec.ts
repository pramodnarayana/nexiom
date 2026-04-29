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

        // 1 CREATE SCHEMA + 11 gateway statements:
        // inbound_gateway table + RENAME payload->request + ADD COLUMN response
        // + 3 indexes (idx_l1_ext_id, idx_l1_object_type, idx_l1_status)
        // + DROP idx_l1_payload_gin + CREATE idx_l1_request_gin
        // + inbound_outbox table + idx_inbound_outbox_claim index + UNIQUE constraint DO block
        expect(db._queryMock).toHaveBeenCalledTimes(12);
        expect(db._queryMock.mock.calls[0][0]).toContain('CREATE SCHEMA IF NOT EXISTS');
        expect(db._queryMock.mock.calls[1][0]).toContain('inbound_gateway');

        const allSql = db._queryMock.mock.calls.map((c: any[]) => String(c[0])).join('\n');
        expect(allSql).toContain('inbound_outbox');
        expect(allSql).toContain('idx_inbound_outbox_claim');
        expect(allSql).toContain('idx_inbound_outbox_trace');
    });

    it('REPLICA_ACTIVE calls schema + gateway + replica DDL', async () => {
        await manager.applyPlan('ws_test', SchemaPlan.REPLICA_ACTIVE);

        // 1 schema + 11 gateway + 5 replica (2 tables + 3 indexes)
        expect(db._queryMock).toHaveBeenCalledTimes(17);
        const allSql = db._queryMock.mock.calls.map((c: any[]) => String(c[0])).join('\n');
        expect(allSql).toContain('inbound_gateway');
        expect(allSql).toContain('replica_entity');
        expect(allSql).toContain('sync_cursor');
    });

    it('NORMALIZE_ACTIVE calls schema + gateway + replica + normalize DDL', async () => {
        await manager.applyPlan('ws_test', SchemaPlan.NORMALIZE_ACTIVE);

        // 1 schema + 11 gateway + 5 replica + 7 normalize
        // (normalized_entity table + ADD COLUMN published_at + 3 indexes + normalized_outbox table + index + DO block constraint)
        expect(db._queryMock).toHaveBeenCalledTimes(24);
        const allSql = db._queryMock.mock.calls.map((c: any[]) => String(c[0])).join('\n');
        expect(allSql).toContain('normalized_entity');
    });

    it('OUTBOUND_ACTIVE calls all five provisioning stages', async () => {
        await manager.applyPlan('ws_test', SchemaPlan.OUTBOUND_ACTIVE);

        const expectedStageCounts = {
            schema: 1,
            gateway: 11, // Updated to include inbound_outbox and related DDL
            replica: 5,
            normalize: 7, // Updated to include normalized_outbox
            // outbound_gateway (1) + uq patch DO $$ (1) + 3 DROP/ADD constraint DO blocks (3) + 3 indexes
            // + sync_log (1) + uq patch DO $$ (1) + 3 indexes
            // + replica_outbox (1) + DELETE dedup (1) + idx_replica_outbox_claim index (1) + uq patch DO $$ (1)
            // + outbound_outbox (1) + multi-step migration DO $$ (1) + uq patch DO $$ (1) + partial index (1) = 21
            outbound: 21,
            total: 45
        };

        expect(db._queryMock).toHaveBeenCalledTimes(expectedStageCounts.total);
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
    });
});