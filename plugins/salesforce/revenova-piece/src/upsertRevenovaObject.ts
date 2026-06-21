import type { ReplicaExtractorFn } from '@soopa/piece-framework';

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
 *
 * Rejects multi-notification payloads to prevent overwrite bugs.
 */
function parseSalesforceSoapXml(xml: string): {
    doctype: string;
    entityId: string;
    data: Record<string, string>;
} | null {
    // 1. Detect multiple <Notification> blocks — reject to prevent silent overwrites
    // Use a strict open-tag regex so we don't accidentally count closing </Notification> tags
    const notificationMatches = xml.match(/<(?:[a-zA-Z0-9_]+:)?Notification(?:\s|>|\/)/gi);
    if (notificationMatches && notificationMatches.length > 1) {
        // Multi-notification payload detected
        return null;
    }

    // 2. Extract the single <sObject> block (or <Notification>/sObject subtree)
    const sObjectMatch = /<sObject[^>]*xsi:type="([^"]+)"[^>]*>([\s\S]*?)<\/sObject>/i.exec(xml);
    if (!sObjectMatch) {
        return null;
    }

    const rawType = sObjectMatch[1];
    const sObjectXml = sObjectMatch[2];

    // 3. Derive entity type: xsi:type="sf:Account" → "Account"
    const doctype = rawType.startsWith('sf:') ? rawType.substring(3) : rawType;

    // 4. Extract leaf elements scoped to this sObject subtree
    const data: Record<string, string> = {};
    const pattern = /<([a-zA-Z_][a-zA-Z0-9_:]*?)>([^<]+)<\/\1>/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(sObjectXml)) !== null) {
        const rawKey = m[1];
        const value = m[2].trim();
        if (!value) continue;
        // Strip sf: namespace prefix then lowercase the whole key
        const key = (rawKey.startsWith('sf:') ? rawKey.substring(3) : rawKey).toLowerCase();
        if (!SOAP_STRUCTURAL_TAGS.has(key)) {
            // Decode XML entities
            const decoded = decodeXmlEntities(value);
            data[key] = decoded;
        }
    }

    // 5. Salesforce always includes the sObject record Id as <sf:Id> → 'id' after lowercase
    const entityId = data['id'];
    if (!entityId) return null;

    return { doctype, entityId, data };
}

/**
 * Decodes XML entities and character references.
 * Handles: &amp; &lt; &gt; &quot; &apos; &#xHH; &#DD;
 */
function decodeXmlEntities(str: string): string {
    return str
        .replace(/&#x([0-9A-Fa-f]+);/g, (match, hex) => {
            const codePoint = parseInt(hex, 16);
            if (codePoint >= 0 && codePoint <= 0x10FFFF) {
                return String.fromCodePoint(codePoint);
            }
            return '\uFFFD'; // Unicode replacement character for invalid code points
        })
        .replace(/&#(\d+);/g, (match, dec) => {
            const codePoint = parseInt(dec, 10);
            if (codePoint >= 0 && codePoint <= 0x10FFFF) {
                return String.fromCodePoint(codePoint);
            }
            return '\uFFFD'; // Unicode replacement character for invalid code points
        })
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}


export const upsertRevenovaObject: ReplicaExtractorFn = (payload, context) => {
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

            let parsedDoctype = parsed.doctype;
            if (context?.objectType) {
                parsedDoctype = context.objectType.startsWith('sf:') ? context.objectType.substring(3) : context.objectType;
            }

            return {
                entityType: parsedDoctype,
                entityId: parsed.entityId,
                data,
            };
        }

        rawObj = p;
    }

    const r_obj: Record<string, unknown> = {};
    
    // Default to context.objectType if available
    let doctype = 'DEFAULT';
    if (context?.objectType) {
        doctype = context.objectType.startsWith('sf:') ? context.objectType.substring(3) : context.objectType;
    }

    // Sanitize keys: strip "sf:" namespace prefix and lowercase for consistency
    for (const [key, value] of Object.entries(rawObj)) {
        if (key === 'attributes' && typeof value === 'object' && value !== null) {
            // Handle Salesforce REST API payload where type is in the attributes object
            const typeValue = (value as Record<string, unknown>)['type'];
            if (typeof typeValue === 'string' && !context?.objectType) {
                doctype = typeValue.startsWith('sf:') ? typeValue.substring(3) : typeValue;
            }
            continue; // Skip putting 'attributes' into the parsed data blob
        }
        
        if (key !== '$') {
            const cleanKey = (key.startsWith('sf:') ? key.substring(3) : key).toLowerCase();
            r_obj[cleanKey] = value;
        } else {
            // Derive doctype from xsi:type attribute on the sObject (SOAP XML fallback)
            const xsi = (value as Record<string, unknown>)?.['xsi:type'];
            if (typeof xsi === 'string' && !context?.objectType) {
                doctype = xsi.startsWith('sf:') ? xsi.substring(3) : xsi;
            }
        }
    }


    // Extract the stable entity ID — required for idempotent upsert keying.
    const idValue = r_obj['id'] ?? r_obj['Id'];

    // Validate that the ID is a non-empty string
    if (typeof idValue !== 'string' || idValue.trim().length === 0) {
        // Without a stable entity ID we cannot safely upsert — fail loudly.
        return null;
    }

    const entityId = idValue;

    // Remove from the data blob — it lives as a dedicated column, not inside JSON.
    delete r_obj['id'];
    delete r_obj['Id'];

    return {
        entityType: doctype,
        entityId,
        data: r_obj,
    };
};