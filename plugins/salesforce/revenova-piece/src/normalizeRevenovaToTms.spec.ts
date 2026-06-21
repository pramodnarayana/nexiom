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
