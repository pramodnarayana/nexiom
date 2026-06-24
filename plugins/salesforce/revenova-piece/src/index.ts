/* v8 ignore start */
import type { Piece } from '@soopa/piece-framework';
import { PieceCategory } from '@soopa/piece-framework';
import { upsertRevenovaObject } from './upsertRevenovaObject.js';
import { normalizeRevenovaToTms } from './normalizeRevenovaToTms.js';

const SALESFORCE_OUTBOUND_ACK = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <notificationsResponse xmlns="http://soap.sforce.com/2005/09/outbound">
      <Ack>true</Ack>
    </notificationsResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

import * as domainTmsApi from '@soopa/domain-tms';

import { createSalesforcePiece } from '@soopa/piece-salesforce';

export function register(): Piece {
    return createSalesforcePiece({
        name: 'salesforce-revenova',
        displayName: 'Revenova',
        description: 'Connect to Revenova TMS to map loads and stops.',
        logoUrl: 'https://cdn.activepieces.com/pieces/salesforce.png',
        categories: [PieceCategory.SALES_AND_CRM],
        appProfile: 'revenova',
        migrationsFolder: domainTmsApi.getTmsMigrationsFolder(),
        appHooks: {
            extractReplica: upsertRevenovaObject,
            normalize: normalizeRevenovaToTms,
            writeNormalized: domainTmsApi.tmsNormalizedWriter,
            buildTarget: domainTmsApi.tmsTargetBuilder,
            getWebhookResponse: (body, headers) => {
                const contentType = (headers['content-type'] || (typeof body === 'object' && body && 'contentType' in body ? String(body.contentType) : '')).toLowerCase();

                if (!contentType.includes('text/xml') && !contentType.includes('application/xml')) {
                    return null;
                }

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

                if (rawString.includes('soap.sforce.com/2005/09/outbound')) {
                    return {
                        status: 200,
                        contentType: 'text/xml',
                        body: SALESFORCE_OUTBOUND_ACK,
                    };
                }
                
                return null;
            }
        }
    });
}
/* v8 ignore stop */