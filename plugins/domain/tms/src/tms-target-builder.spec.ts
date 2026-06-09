import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmsTargetBuilder } from './tms-target-builder.js';
import type { AppsConnectorDb } from '@soopa/piece-framework';

// Mock DependenciesMissingError
vi.mock('@soopa/piece-framework', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@soopa/piece-framework')>();
    return {
        ...actual,
        DependenciesMissingError: class extends Error {
            constructor(public missing: any) {
                super('DependenciesMissingError');
            }
        },
    };
});

describe('tmsTargetBuilder', () => {
    let mockDb: { select: ReturnType<typeof vi.fn> };
    let mockSelectChain: any;

    beforeEach(() => {
        mockSelectChain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([]),
        };

        mockDb = {
            select: vi.fn().mockReturnValue(mockSelectChain),
        };
    });

    it('should return empty object for non-carrier types', async () => {
        const result = await tmsTargetBuilder(mockDb as unknown as AppsConnectorDb, 'ws_tenant_1', 'TMS_CUSTOMER', 'src_1');
        expect(result).toEqual({});
        expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should return empty object if account is not found', async () => {
        mockSelectChain.limit.mockResolvedValueOnce([]); // No account rows
        const result = await tmsTargetBuilder(mockDb as unknown as AppsConnectorDb, 'ws_tenant_1', 'TMS_CARRIER', 'src_1');
        expect(result).toEqual({});
    });

    it('should enrich account without TP or Remit-To', async () => {
        mockSelectChain.limit.mockResolvedValueOnce([{ displayName: 'Carrier A', tmsType: 'Carrier' }]); // Account
        
        const result = await tmsTargetBuilder(mockDb as unknown as AppsConnectorDb, 'ws_tenant_1', 'TMS_CARRIER', 'src_1');
        
        expect(result).toEqual({
            displayName: 'Carrier A',
            tmsType: 'Carrier',
            billingStreet: undefined,
            billingCity: undefined,
            billingState: undefined,
            billingPostalCode: undefined,
            billingCountry: undefined,
            phone: undefined,
            fax: undefined,
            email: undefined,
            tp: null,
            remitTo: null,
        });
    });

    it('should throw DependenciesMissingError if TP is missing', async () => {
        mockSelectChain.limit.mockResolvedValueOnce([{ displayName: 'Carrier A', tpSourceId: 'tp_1' }]); // Account
        mockSelectChain.limit.mockResolvedValueOnce([]); // TP not found

        await expect(tmsTargetBuilder(mockDb as unknown as AppsConnectorDb, 'ws_tenant_1', 'TMS_CARRIER', 'src_1'))
            .rejects.toThrow('DependenciesMissingError');
    });

    it('should enrich account with TP and Remit-To from carrier table', async () => {
        mockSelectChain.limit.mockResolvedValueOnce([{ displayName: 'Carrier A', tpSourceId: 'tp_1', remitToSourceId: 'remit_1' }]); // Account
        mockSelectChain.limit.mockResolvedValueOnce([{ mcNumber: 'MC-123' }]); // TP
        mockSelectChain.limit.mockResolvedValueOnce([{ displayName: 'Self Remit' }]); // Remit-To (tmsCarrier)

        const result = await tmsTargetBuilder(mockDb as unknown as AppsConnectorDb, 'ws_tenant_1', 'TMS_CARRIER', 'src_1');
        
        expect(result.tp).toEqual({ mcNumber: 'MC-123', invoiceTerms: undefined, paymentTerms: undefined, carrierPaymentTerms: undefined, companyType: undefined, creditLimit: undefined, remitToOption: undefined, stateDotNumber: undefined, usDotNumber: undefined });
        expect(result.remitTo).toEqual({ displayName: 'Self Remit', street: undefined, city: undefined, state: undefined, postalCode: undefined, country: undefined, phone: undefined, fax: undefined });
    });

    it('should throw DependenciesMissingError if Remit-To is missing entirely', async () => {
        mockSelectChain.limit.mockResolvedValueOnce([{ displayName: 'Carrier A', remitToSourceId: 'remit_1' }]); // Account
        mockSelectChain.limit.mockResolvedValueOnce([]); // Remit-To (tmsCarrier)
        mockSelectChain.limit.mockResolvedValueOnce([]); // Remit-To (tmsFactoring)

        await expect(tmsTargetBuilder(mockDb as unknown as AppsConnectorDb, 'ws_tenant_1', 'TMS_CARRIER', 'src_1'))
            .rejects.toThrow('DependenciesMissingError');
    });
});
