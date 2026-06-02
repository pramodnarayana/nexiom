import { registerReplicaExtractor, registerNormalizer, registerAppWebhookResponse, registerNormalizedWriter, registerTargetBuilder, registerDomainProvisioner } from '@nexiom/piece-framework';
import { upsertRevenovaObject } from './upsertRevenovaObject.js';
import { normalizeRevenovaToTms } from './normalizeRevenovaToTms.js';
import { tmsNormalizedWriter, tmsTargetBuilder, provisionTmsTables } from '@nexiom/domain-tms';
import type { AppsConnectorDb } from '@nexiom/piece-framework';

const SALESFORCE_OUTBOUND_ACK = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <notificationsResponse xmlns="http://soap.sforce.com/2005/09/outbound">
      <Ack>true</Ack>
    </notificationsResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

export function initializeRevenovaApplicationRegistry() {
    registerReplicaExtractor('salesforce', 'revenova', upsertRevenovaObject);
    registerNormalizer('salesforce', 'revenova', normalizeRevenovaToTms);
    registerNormalizedWriter('salesforce', 'revenova', tmsNormalizedWriter);
    registerTargetBuilder('salesforce', 'revenova', tmsTargetBuilder);
    registerDomainProvisioner('salesforce', (db, schemaName) =>
        provisionTmsTables(db as AppsConnectorDb, schemaName)
    );

    registerAppWebhookResponse((body, headers) => {
        // Normalize content-type to lowercase for case-insensitive comparison
        const contentType = (headers['content-type'] || (typeof body === 'object' && body && 'contentType' in body ? String(body.contentType) : '')).toLowerCase();

        // Fast-fail: Salesforce Outbound Messages are always XML
        if (!contentType.includes('text/xml') && !contentType.includes('application/xml')) {
            return null;
        }

        // Safely extract raw string from the normalized L1 payload wrapper
        let rawString = '';
        if (typeof body === 'string') {
            rawString = body;
        } else if (
            body &&
            typeof body === 'object' &&
            'raw' in body &&
            typeof (body as Record<string, unknown>).raw === 'string'
        ) {
            rawString = (body as Record<string, unknown>).raw as string;
        }

        // Look for the unique XML namespace indicating a Salesforce Outbound Message
        if (rawString.includes('soap.sforce.com/2005/09/outbound')) {
            return {
                status: 200,
                contentType: 'text/xml',
                body: SALESFORCE_OUTBOUND_ACK,
            };
        }
        
        return null;
    });
}

// Invoke at module load time to ensure handlers are registered before lookups
initializeRevenovaApplicationRegistry();