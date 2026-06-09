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

    it('should normalize valid object correctly', () => {
        mockEvaluate.mockReturnValueOnce({
            canonicalType: 'TMS_CARRIER',
            data: { displayName: 'Carrier A' },
        });

        const result = normalizeRevenovaToTms({
            entityType: 'rtms__Carrier__c',
            data: { Name: 'Carrier A' }
        });

        expect(result).toEqual({
            canonicalType: 'TMS_CARRIER',
            data: { displayName: 'Carrier A' },
        });
    });

    it('should return null if result is falsy', () => {
        mockEvaluate.mockReturnValueOnce(null);
        const result = normalizeRevenovaToTms({ entityType: 'rtms__Carrier__c', data: {} });
        expect(result).toBeNull();
    });

    it('should return null if canonicalType is missing', () => {
        mockEvaluate.mockReturnValueOnce({
            data: { displayName: 'Carrier A' },
        });
        const result = normalizeRevenovaToTms({ entityType: 'rtms__Carrier__c', data: {} });
        expect(result).toBeNull();
    });

    it('should return null if data is missing or array', () => {
        mockEvaluate.mockReturnValueOnce({
            canonicalType: 'TMS_CARRIER',
            data: [],
        });
        const result = normalizeRevenovaToTms({ entityType: 'rtms__Carrier__c', data: {} });
        expect(result).toBeNull();
    });

    it('should return null if JSONata evaluation throws', () => {
        mockEvaluate.mockImplementationOnce(() => {
            throw new Error('JSONata error');
        });
        const result = normalizeRevenovaToTms({ entityType: 'rtms__Carrier__c', data: {} });
        expect(result).toBeNull();
    });
});
