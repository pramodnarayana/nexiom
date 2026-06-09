import { describe, it, expect, vi, beforeEach } from 'vitest';
import { provisionTmsTables } from './tms-provisioner.js';
import type { AppsConnectorDb } from '@soopa/piece-framework';

describe('provisionTmsTables', () => {
    let mockTx: { execute: ReturnType<typeof vi.fn> };
    let mockDb: { transaction: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        mockTx = {
            execute: vi.fn().mockResolvedValue(undefined),
        };
        mockDb = {
            transaction: vi.fn().mockImplementation(async (cb) => {
                await cb(mockTx);
            }),
        };
    });

    it('should execute DDL to provision tables', async () => {
        await provisionTmsTables(mockDb as unknown as AppsConnectorDb, 'ws_tenant_1');

        expect(mockDb.transaction).toHaveBeenCalledTimes(1);
        
        // 1 function trigger + (tables + indexes + triggers) = 28 statements
        expect(mockTx.execute).toHaveBeenCalledTimes(28);
        
        const calls = mockTx.execute.mock.calls;
        
        // Check for specific substrings in the generated SQL
        expect(JSON.stringify(calls[0][0])).toContain('CREATE OR REPLACE FUNCTION \\"ws_tenant_1\\".refresh_updated_at()');
        expect(JSON.stringify(calls[1][0])).toContain('CREATE TABLE IF NOT EXISTS \\"ws_tenant_1\\".tms_carrier');
        expect(JSON.stringify(calls[6][0])).toContain('CREATE TABLE IF NOT EXISTS \\"ws_tenant_1\\".tms_vendor');
        expect(JSON.stringify(calls[11][0])).toContain('CREATE TABLE IF NOT EXISTS \\"ws_tenant_1\\".tms_customer');
        expect(JSON.stringify(calls[15][0])).toContain('CREATE TABLE IF NOT EXISTS \\"ws_tenant_1\\".tms_factoring');
        expect(JSON.stringify(calls[19][0])).toContain('CREATE TABLE IF NOT EXISTS \\"ws_tenant_1\\".tms_address');
        expect(JSON.stringify(calls[23][0])).toContain('CREATE TABLE IF NOT EXISTS \\"ws_tenant_1\\".tms_tp');
    });

    it('should throw an error for invalid schema names to prevent SQL injection', async () => {
        await expect(provisionTmsTables(mockDb as unknown as AppsConnectorDb, 'invalid"name'))
            .rejects.toThrow();
        
        expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('should throw an error for schema names exceeding 63 chars', async () => {
        const longName = 'ws_' + 'a'.repeat(65);
        await expect(provisionTmsTables(mockDb as unknown as AppsConnectorDb, longName))
            .rejects.toThrow(/exceeds Postgres identifier limit/);
        
        expect(mockDb.transaction).not.toHaveBeenCalled();
    });
});
