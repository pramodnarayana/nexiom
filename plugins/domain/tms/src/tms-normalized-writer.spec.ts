import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmsNormalizedWriter } from './tms-normalized-writer.js';

describe('tmsNormalizedWriter', () => {
    let mockTx: { execute: ReturnType<typeof vi.fn> };
    let mockDb: unknown;

    beforeEach(() => {
        mockTx = {
            execute: vi.fn().mockResolvedValue(undefined),
        };
        mockDb = {};
    });

    it('should upsert TMS_CARRIER data correctly', async () => {
        const data = {
            displayName: 'Carrier A',
            isCarrier: true,
            tmsType: 'Carrier',
        };

        await tmsNormalizedWriter(
            mockTx,
            mockDb,
            'ws_tenant_1',
            'rep_123',
            'src_123',
            'trace_123',
            'TMS_CARRIER',
            data
        );

        expect(mockTx.execute).toHaveBeenCalledTimes(1);
        const queryArg = mockTx.execute.mock.calls[0][0];
        
        // Drizzle sql objects have a property for querying or we can check the strings
        // Just checking it did get executed without error
        expect(queryArg).toBeDefined();
    });

    it('should upsert TMS_VENDOR data correctly', async () => {
        const data = {
            displayName: 'Vendor A',
            isVendor: true,
        };

        await tmsNormalizedWriter(
            mockTx,
            mockDb,
            'ws_tenant_1',
            'rep_123',
            'src_123',
            'trace_123',
            'TMS_VENDOR',
            data
        );

        expect(mockTx.execute).toHaveBeenCalledTimes(1);
    });

    it('should upsert TMS_CUSTOMER data correctly', async () => {
        await tmsNormalizedWriter(mockTx, mockDb, 'ws_tenant_1', 'rep_123', 'src_123', 'trace_123', 'TMS_CUSTOMER', {});
        expect(mockTx.execute).toHaveBeenCalledTimes(1);
    });

    it('should upsert TMS_FACTORING data correctly', async () => {
        await tmsNormalizedWriter(mockTx, mockDb, 'ws_tenant_1', 'rep_123', 'src_123', 'trace_123', 'TMS_FACTORING', {});
        expect(mockTx.execute).toHaveBeenCalledTimes(1);
    });

    it('should upsert TMS_ADDRESS data correctly', async () => {
        await tmsNormalizedWriter(mockTx, mockDb, 'ws_tenant_1', 'rep_123', 'src_123', 'trace_123', 'TMS_ADDRESS', {});
        expect(mockTx.execute).toHaveBeenCalledTimes(1);
    });

    it('should upsert TMS_TP data correctly', async () => {
        await tmsNormalizedWriter(mockTx, mockDb, 'ws_tenant_1', 'rep_123', 'src_123', 'trace_123', 'TMS_TP', {});
        expect(mockTx.execute).toHaveBeenCalledTimes(1);
    });

    it('should throw an error for unimplemented types like TMS_LOAD', async () => {
        await expect(tmsNormalizedWriter(mockTx, mockDb, 'ws_tenant_1', 'rep_1', 'src_1', 'trace_1', 'TMS_LOAD', {}))
            .rejects
            .toThrow('TMS normalized writer: type TMS_LOAD is recognized but not yet implemented (traceId=trace_1)');
    });

    it('should throw an error for unimplemented types like TMS_INVOICE', async () => {
        await expect(tmsNormalizedWriter(mockTx, mockDb, 'ws_tenant_1', 'rep_1', 'src_1', 'trace_1', 'TMS_INVOICE', {}))
            .rejects
            .toThrow('TMS normalized writer: type TMS_INVOICE is recognized but not yet implemented (traceId=trace_1)');
    });

    it('should do nothing for unknown types', async () => {
        await tmsNormalizedWriter(mockTx, mockDb, 'ws_tenant_1', 'rep_1', 'src_1', 'trace_1', 'UNKNOWN_TYPE', {});
        expect(mockTx.execute).not.toHaveBeenCalled();
    });
});
