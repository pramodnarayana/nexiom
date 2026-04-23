import type { ReplicaExtractorFn } from '@nexiom/piece-framework';

interface SalesforceEnvelope {
    notification?: {
        sobject?: Record<string, unknown>;
    };
}

// SOAP structural wrapper tags — carry no business data, skip them.
// All lowercase to match the normalised key comparison below.
const SOAP_STRUCTURAL_TAGS = new Set([
    'envelope', 'body', 'header', 'notifications', 'notification', 'sobject',
]);

/**
 * Parses a Salesforce SOAP Outbound Message XML into a structured data blob.
 *
 * Captures everything meaningful inside the <notification> element:
 *   - All <sf:*> sObject fields (namespace stripped → bare key)
 *   - Custom fields: <rtms__Status__c>, <myField__c>, etc.
 *   - Notification-level metadata (Id, actionId, etc.)
 *
 * Returns entityId (sf:Id) and doctype (xsi:type) as first-class values
 * so they are stored as dedicated columns, not buried in the JSON blob.
 */
function parseSalesforceSoapXml(xml: string): {
    doctype: string;
    entityId: string;
    data: Record<string, string>;
} | null {
    // 1. Derive entity type: xsi:type="sf:Account" → "sf_Account"
    const typeMatch = /xsi:type="([^"]+)"/.exec(xml);
    let doctype = 'DEFAULT';
    if (typeMatch) {
        const raw = typeMatch[1];
        const typeName = raw.startsWith('sf:') ? raw.substring(3) : raw;
        doctype = typeName.startsWith('rtms__') ? typeName : `sf_${typeName}`;
    }

    // 2. Extract every leaf text element from the notification payload.
    //    Keys are always lowercased for predictable downstream mapping:
    //    <sf:Id>001…</sf:Id>  → { id: '001…' }
    //    <sf:Name>Acme</sf:Name> → { name: 'Acme' }
    //    <rtms__Status__c>Active</rtms__Status__c> → { rtms__status__c: 'Active' }
    const data: Record<string, string> = {};
    const pattern = /<([a-zA-Z_][a-zA-Z0-9_:]*?)>([^<]+)<\/\1>/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(xml)) !== null) {
        const rawKey = m[1];
        const value = m[2].trim();
        if (!value) continue;
        // Strip sf: namespace prefix then lowercase the whole key
        const key = (rawKey.startsWith('sf:') ? rawKey.substring(3) : rawKey).toLowerCase();
        if (!SOAP_STRUCTURAL_TAGS.has(key)) {
            data[key] = value;
        }
    }

    // 3. Salesforce always includes the sObject record Id as <sf:Id> → 'id' after lowercase.
    const entityId = data['id'];
    if (!entityId) return null;

    return { doctype, entityId, data };
}


export const upsertRevenovaObject: ReplicaExtractorFn = (payload) => {
    if (!payload || typeof payload !== 'object') return null;

    // Mimic the Python unwrapping behavior
    // 1. Dig through Salesforce outbound message envelope if present
    let rawObj: Record<string, unknown>;
    const envelope = payload as SalesforceEnvelope;

    // Runtime validation of envelope structure
    if (envelope.notification !== undefined && envelope.notification !== null) {
        // Envelope is present, validate it's an object
        if (typeof envelope.notification !== 'object') {
            // Malformed envelope: notification exists but is not an object
            return null;
        }

        // Validate sobject is present and is an object
        if (
            envelope.notification.sobject === undefined ||
            envelope.notification.sobject === null ||
            typeof envelope.notification.sobject !== 'object'
        ) {
            // Malformed envelope: sobject missing or invalid
            return null;
        }

        rawObj = envelope.notification.sobject;
    } else {
        // XML raw payload: { raw: "<xml…>", contentType: "text/xml" }
        const p = payload as Record<string, unknown>;
        if (typeof p['raw'] === 'string' && typeof p['contentType'] === 'string' && p['contentType'].includes('xml')) {
            const parsed = parseSalesforceSoapXml(p['raw'] as string);
            if (!parsed) return null;

            // entityId is extracted as a first-class column; remove it from the data blob.
            const data = { ...parsed.data };
            delete data['id'];

            return {
                entityType: parsed.doctype,
                entityId: parsed.entityId,
                data,
            };
        }

        rawObj = p;
    }

    const r_obj: Record<string, unknown> = {};
    let doctype = 'DEFAULT';

    // Sanitize keys: strip "sf:" namespace prefix and lowercase for consistency
    for (const [key, value] of Object.entries(rawObj)) {
        if (key !== '$') {
            const cleanKey = (key.startsWith('sf:') ? key.substring(3) : key).toLowerCase();
            r_obj[cleanKey] = value;
        } else {
            // Derive doctype from xsi:type attribute on the sObject
            const xsi = (value as Record<string, unknown>)?.['xsi:type'];
            if (typeof xsi === 'string') {
                const typeName = xsi.startsWith('sf:') ? xsi.substring(3) : xsi;
                doctype = typeName.startsWith('rtms__') ? typeName : `sf_${typeName}`;
            }
        }
    }


    // Extract the stable entity ID — required for idempotent upsert keying.
    const entityId = (r_obj['id'] ?? r_obj['Id']) as string | undefined;
    if (!entityId) {
        // Without a stable entity ID we cannot safely upsert — fail loudly.
        return null;
    }
    // Remove from the data blob — it lives as a dedicated column, not inside JSON.
    delete r_obj['id'];
    delete r_obj['Id'];

    return {
        entityType: doctype,
        entityId,
        data: r_obj,
    };
};