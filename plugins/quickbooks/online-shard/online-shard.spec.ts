import { describe, it, expect } from 'vitest';
import { NormaliseQBObject } from './normalise.js';
import { ReplicateQBObject } from './replicate.js';
import { PrepareQBUpdatePayload } from './prepare-update.js';

describe('quickbooks online-shard', () => {
    describe('NormaliseQBObject', () => {
        it('should return null to indicate raw storage', async () => {
            const result = await NormaliseQBObject('Customer', { name: 'Test' });
            expect(result).toBeNull();
        });
    });

    describe('ReplicateQBObject', () => {
        it('should return null for invalid payload', async () => {
            expect(await ReplicateQBObject(null)).toBeNull();
            expect(await ReplicateQBObject('string')).toBeNull();
            expect(await ReplicateQBObject({ id: '123' })).toBeNull(); // missing name
            expect(await ReplicateQBObject({ name: 'Customer' })).toBeNull(); // missing id
        });

        it('should replicate valid payload', async () => {
            const payload = { name: 'Customer', id: '123', customField: 'value' };
            const result = await ReplicateQBObject(payload);
            expect(result).toEqual({
                entityType: 'Customer',
                entityId: '123',
                data: payload,
            });
        });
    });

    describe('PrepareQBUpdatePayload', () => {
        it('should strip internal pipeline metadata', async () => {
            const payload = { _routingEnvelope: 'test', name: 'Vendor' };
            const result = await PrepareQBUpdatePayload(payload);
            expect(result).toEqual({ name: 'Vendor', sparse: true, domain: 'QBO' });
        });

        it('should inject destId', async () => {
            const payload = { name: 'Vendor' };
            const result = await PrepareQBUpdatePayload(payload, '123');
            expect(result).toEqual({ name: 'Vendor', Id: '123', sparse: true, domain: 'QBO' });
        });

        it('should inject direct SyncToken from destState', async () => {
            const payload = { name: 'Vendor' };
            const destState = { SyncToken: '4' };
            const result = await PrepareQBUpdatePayload(payload, '123', destState);
            expect(result).toEqual({ name: 'Vendor', Id: '123', SyncToken: '4', sparse: true, domain: 'QBO' });
        });

        it('should inject nested SyncToken from destState envelope', async () => {
            const payload = { name: 'Vendor' };
            const destState = { Vendor: { SyncToken: '5' } };
            const result = await PrepareQBUpdatePayload(payload, '123', destState);
            expect(result).toEqual({ name: 'Vendor', Id: '123', SyncToken: '5', sparse: true, domain: 'QBO' });
        });
    });
});
