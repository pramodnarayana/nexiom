import { describe, it, expect } from 'vitest';
import { ReplicateRevenovaObject } from './replicate.js';

describe('ReplicateRevenovaObject', () => {
    it('should return null for invalid payload', async () => {
        expect(await ReplicateRevenovaObject(null)).toBeNull();
        expect(await ReplicateRevenovaObject(undefined)).toBeNull();
        expect(await ReplicateRevenovaObject({})).toBeNull();
        expect(await ReplicateRevenovaObject({ raw: null })).toBeNull();
    });

    it('should parse JSON REST API polling payload', async () => {
        const payload = {
            attributes: { type: 'rtms__Carrier__c' },
            Id: '001_abc',
            Name: 'Test Carrier',
            IsActive: true,
            NullValue: null,
            UndefinedValue: undefined,
            NestedObject: { key: 'value' },
        };

        const result = await ReplicateRevenovaObject(payload);

        expect(result).toEqual({
            entityType: 'rtms__Carrier__c',
            entityId: '001_abc',
            data: {
                id: '001_abc',
                name: 'Test Carrier',
                isactive: 'true',
                nestedobject: '{"key":"value"}',
            }
        });
    });

    it('should parse XML SOAP Outbound Message from string payload', async () => {
        const xml = `
            <sObject xsi:type="sf:Account" xmlns:sf="urn:sobject.enterprise.soap.sforce.com">
                <sf:Id>xml_123</sf:Id>
                <sf:Name>Test XML</sf:Name>
                <sf:Status>Active</sf:Status>
            </sObject>
        `;

        const result = await ReplicateRevenovaObject(xml);

        expect(result).toEqual({
            entityType: 'Account',
            entityId: 'xml_123',
            data: {
                id: 'xml_123',
                name: 'Test XML',
                status: 'Active',
            }
        });
    });

    it('should parse XML SOAP Outbound Message from { raw: string } payload', async () => {
        const xml = `
            <sObject xsi:type="sf:Contact">
                <sf:Id>xml_456</sf:Id>
                <sf:Email>test@example.com</sf:Email>
            </sObject>
        `;

        const result = await ReplicateRevenovaObject({ raw: xml });

        expect(result).toEqual({
            entityType: 'Contact',
            entityId: 'xml_456',
            data: {
                id: 'xml_456',
                email: 'test@example.com',
            }
        });
    });

    it('should return null for XML without sObject type', async () => {
        const xml = `
            <sObject>
                <sf:Id>xml_456</sf:Id>
            </sObject>
        `;

        const result = await ReplicateRevenovaObject({ raw: xml });
        expect(result).toBeNull();
    });

    it('should decode XML entities', async () => {
        const xml = `
            <sObject xsi:type="sf:Account">
                <sf:Id>xml_123</sf:Id>
                <sf:Name>Me &amp; You &lt;3 &quot;yes&quot; &apos;no&apos;</sf:Name>
            </sObject>
        `;

        const result = await ReplicateRevenovaObject(xml);
        expect(result?.data.name).toBe('Me & You <3 "yes" \'no\'');
    });
});
