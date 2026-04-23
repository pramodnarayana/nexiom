import { registerReplicaExtractor, registerNormalizer, registerAppWebhookResponse } from '@nexiom/piece-framework';
import { upsertRevenovaObject } from './upsertRevenovaObject.js';
import { upsertTMSObject } from './upsertTMSObject.js';

const SALESFORCE_OUTBOUND_ACK = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <notificationsResponse xmlns="http://soap.sforce.com/2005/09/outbound">
      <Ack>true</Ack>
    </notificationsResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

export function initializeRevenovaApplicationRegistry() {
    registerReplicaExtractor('salesforce', 'revenova', upsertRevenovaObject);
    registerNormalizer('salesforce', 'revenova', upsertTMSObject);

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