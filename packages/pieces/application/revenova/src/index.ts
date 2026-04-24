import { registerReplicaExtractor, registerNormalizer, registerAppWebhookResponse, registerNormalizedWriter, registerTargetBuilder, registerDomainProvisioner } from '@nexiom/piece-framework';
import { upsertRevenovaObject } from './upsertRevenovaObject.js';
import { normalizeRevenovaToTms } from './normalizeRevenovaToTms.js';
import { tmsNormalizedWriter, tmsTargetBuilder, provisionTmsTables } from '@nexiom/domain-tms';
import type { DrizzleDb } from '@nexiom/database';

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
        provisionTmsTables(db as DrizzleDb, schemaName)
    );

    registerAppWebhookResponse((body) => {
        if (
            typeof body === 'string' &&
            body.includes('soap.sforce.com/2005/09/outbound')
        ) {
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