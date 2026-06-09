import { describe, it, expect } from 'vitest';
import { NormaliseRevenovaObject } from './normalise.js';

describe('NormaliseRevenovaObject', () => {
    describe('normalizeAccount', () => {
        it('should normalize TMS_FACTORING', async () => {
            const data = { id: '1', name: 'Factor', rtms__tms_type__c: 'Factoring Company' };
            const result = await NormaliseRevenovaObject({ entityType: 'Account', data });
            expect(result?.canonicalType).toBe('TMS_FACTORING');
            expect(result?.data.displayName).toBe('Factor');
        });

        it('should normalize TMS_VENDOR', async () => {
            const data = { id: '1', name: 'Vendor A', rtms__tms_type__c: 'Vendor' };
            const result = await NormaliseRevenovaObject({ entityType: 'Account', data });
            expect(result?.canonicalType).toBe('TMS_VENDOR');
        });

        it('should normalize TMS_CUSTOMER', async () => {
            const data = { id: '1', name: 'Customer A', rtms__tms_type__c: 'Customer' };
            const result = await NormaliseRevenovaObject({ entityType: 'Account', data });
            expect(result?.canonicalType).toBe('TMS_CUSTOMER');
        });

        it('should normalize TMS_CARRIER if Carrier', async () => {
            const data = { id: '1', name: 'Carrier A', rtms__tms_type__c: 'Carrier' };
            const result = await NormaliseRevenovaObject({ entityType: 'Account', data });
            expect(result?.canonicalType).toBe('TMS_CARRIER');
        });

        it('should return null if not carrier, vendor, factor, customer', async () => {
            const data = { id: '1', name: 'Other', rtms__tms_type__c: 'Other' };
            const result = await NormaliseRevenovaObject({ entityType: 'Account', data });
            expect(result).toBeNull();
        });

        it('should map address fields correctly', async () => {
            const data = {
                id: '1',
                name: 'Carrier A',
                rtms__tms_type__c: 'Carrier',
                billingstreet: '123 Main St',
                billingcity: 'Anytown',
                billingstate: 'NY',
                billingpostalcode: '12345',
                billingcountry: 'USA',
                phone: '555-1234',
                fax: '555-5678',
                rtms__transportation_profile__c: 'tp_123'
            };
            const result = await NormaliseRevenovaObject({ entityType: 'Account', data });
            expect(result?.data.billingStreet).toBe('123 Main St');
            expect(result?.data.tpSourceId).toBe('tp_123');
            expect(result?.data.phone).toBe('555-1234');
        });
    });

    describe('normalizeTransportationProfile', () => {
        it('should normalize TransportationProfile__c', async () => {
            const data = { id: 'tp_1', rtms__mc_number__c: 'MC-123' };
            const result = await NormaliseRevenovaObject({ entityType: 'TransportationProfile__c', data });
            expect(result?.canonicalType).toBe('TMS_TP');
            expect(result?.data.mcNumber).toBe('MC-123');
        });

        it('should normalize rtms__TransportationProfile__c', async () => {
            const data = { id: 'tp_2', rtms__us_dot_number__c: 'DOT-456' };
            const result = await NormaliseRevenovaObject({ entityType: 'rtms__TransportationProfile__c', data });
            expect(result?.canonicalType).toBe('TMS_TP');
            expect(result?.data.usdot).toBe('DOT-456');
        });
    });

    it('should return null for unmapped types', async () => {
        const result = await NormaliseRevenovaObject({ entityType: 'UnknownType', data: {} });
        expect(result).toBeNull();
    });
});
