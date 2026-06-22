import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEvaluate } = vi.hoisted(() => {
    return { mockEvaluate: vi.fn() };
});

vi.mock('node:fs', () => ({
    default: {
        readFileSync: vi.fn().mockReturnValue('dummy'),
    }
}));

vi.mock('jsonata', () => ({
    default: () => ({
        evaluate: mockEvaluate,
    }),
}));

import { normalizeRevenovaToTms } from './normalizeRevenovaToTms.js';

describe('normalizeRevenovaToTms', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should normalize valid object correctly', async () => {
        mockEvaluate.mockReturnValueOnce({
            canonicalType: 'TMS_CARRIER',
            data: { displayName: 'Carrier A' },
        });

        const result = await normalizeRevenovaToTms({
            entityType: 'rtms__Carrier__c',
            data: { Name: 'Carrier A' }
        });

        expect(result).toEqual({
            canonicalType: 'TMS_CARRIER',
            data: { displayName: 'Carrier A' },
        });
    });

    it('should return null if result is falsy', async () => {
        mockEvaluate.mockReturnValueOnce(null);
        const result = await normalizeRevenovaToTms({ entityType: 'rtms__Carrier__c', data: {} });
        expect(result).toBeNull();
    });

    it('should return null if canonicalType is missing', async () => {
        mockEvaluate.mockReturnValueOnce({
            data: { displayName: 'Carrier A' },
        });
        const result = await normalizeRevenovaToTms({ entityType: 'rtms__Carrier__c', data: {} });
        expect(result).toBeNull();
    });

    it('should return null if data is missing or array', async () => {
        mockEvaluate.mockReturnValueOnce({
            canonicalType: 'TMS_CARRIER',
            data: [],
        });
        const result = await normalizeRevenovaToTms({ entityType: 'rtms__Carrier__c', data: {} });
        expect(result).toBeNull();
    });

    it('should return null if JSONata evaluation throws', async () => {
        mockEvaluate.mockImplementationOnce(() => {
            throw new Error('JSONata error');
        });
        const result = await normalizeRevenovaToTms({ entityType: 'rtms__Carrier__c', data: {} });
        expect(result).toBeNull();
    });
});

describe('normalizeRevenovaToTms - Real JSONata Integration Tests', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('should correctly map Account to TMS_CARRIER with real JSONata', async () => {
        vi.unmock('jsonata');
        const { normalizeRevenovaToTms: realNormalizer } = await import('./normalizeRevenovaToTms.js');

        const result = await realNormalizer({
            entityType: 'Account',
            data: {
                name: 'Test Carrier Inc',
                rtms__tms_type__c: 'carrier',
                rtms__transportation_profile__c: 'tp-123',
                billingstreet: '123 Main St',
                billingcity: 'Springfield',
                billingstate: 'IL',
                billingpostalcode: '62701',
                billingcountry: 'USA',
                phone: '555-1234',
                fax: '555-5678',
                email: 'contact@carrier.com',
                akatia__carrier__c: 'true',
                akatia__broker__c: 'false'
            }
        });

        expect(result).not.toBeNull();
        expect(result?.canonicalType).toBe('TMS_CARRIER');
        expect(result?.data.displayName).toBe('Test Carrier Inc');
        expect(result?.data.tmsType).toBe('carrier');
        expect(result?.data.tpSourceId).toBe('tp-123');
        expect(result?.data.billingStreet).toBe('123 Main St');
        expect(result?.data.billingCity).toBe('Springfield');
        expect(result?.data.phone).toBe('555-1234');
        expect(result?.data.isCarrier).toBe('true');
    });

    it('should correctly map rtms__TransportationProfile__c to TMS_TP with real JSONata', async () => {
        vi.unmock('jsonata');
        const { normalizeRevenovaToTms: realNormalizer } = await import('./normalizeRevenovaToTms.js');

        const result = await realNormalizer({
            entityType: 'rtms__TransportationProfile__c',
            data: {
                rtms__invoice_terms__c: 'Net 30',
                rtms__payment_terms__c: 'Net 15',
                rtms__carrier_payment_terms__c: 'Net 45',
                rtms__carrier_remit_to__c: 'carrier-remit-123',
                rtms__company_type__c: 'LLC',
                rtms__credit_limit__c: '50000',
                rtms__remit_to_option__c: 'Direct',
                rtms__mc_number__c: 'MC123456',
                rtms__state_dot_number__c: 'SD789',
                rtms__usdot_number__c: 'USDOT987654'
            }
        });

        expect(result).not.toBeNull();
        expect(result?.canonicalType).toBe('TMS_TP');
        expect(result?.data.invoiceTerms).toBe('Net 30');
        expect(result?.data.paymentTerms).toBe('Net 15');
        expect(result?.data.carrierPaymentTerms).toBe('Net 45');
        expect(result?.data.carrierRemitTo).toBe('carrier-remit-123');
        expect(result?.data.companyType).toBe('LLC');
        expect(result?.data.creditLimit).toBe('50000');
        expect(result?.data.mcNumber).toBe('MC123456');
        expect(result?.data.stateDotNumber).toBe('SD789');
        expect(result?.data.usDotNumber).toBe('USDOT987654');
    });
});
