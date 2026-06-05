import { XMLParser } from 'fast-xml-parser';

/**
 * Extracts the core entity from a Revenova (Salesforce) Outbound Message SOAP XML payload.
 */
export async function ReplicateRevenovaObject(payload: unknown): Promise<{ entityType: string; entityId: string; data: Record<string, unknown> } | null> {
    // The inbound_gateway stores payloads as { raw: string, contentType: string }.
    // Unwrap the envelope before parsing.
    let body: string | undefined;
    if (typeof payload === 'string') {
        body = payload;
    } else if (payload !== null && typeof payload === 'object') {
        const p = payload as Record<string, unknown>;
        if (typeof p['raw'] === 'string') {
            body = p['raw'];
        } else if (p['attributes'] && typeof (p['attributes'] as Record<string, unknown>)['type'] === 'string' && p['Id']) {
            // It's a JSON REST API payload from polling!
            const entityType = (p['attributes'] as Record<string, unknown>)['type'] as string;
            const entityId = p['Id'] as string;
            
            // Normalize keys to lowercase to match the XML extraction behavior downstream
            const data: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(p)) {
                if (key !== 'attributes') {
                    // Skip null/undefined values
                    if (value === null || value === undefined) {
                        continue;
                    }
                    // Stringify values if they are objects (though standard SF fields are primitives)
                    data[key.toLowerCase()] = typeof value === 'object' ? JSON.stringify(value) : String(value);
                }
            }
            return {
                entityType,
                entityId,
                data,
            };
        } else {
            return null;
        }
    } else {
        return null;
    }

    if (!body) {
        return null;
    }

    // Parse the SOAP XML
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        parseTagValue: false, // keep everything as string
    });

    let parsed: any;
    try {
        parsed = parser.parse(body);
    } catch (err) {
        return null;
    }

    // Navigate to the sObject node inside the Envelope -> Body -> notifications -> Notification -> sObject
    const envelope = parsed['soapenv:Envelope'] || parsed['Envelope'];
    if (!envelope) return null;
    
    const bodyNode = envelope['soapenv:Body'] || envelope['Body'];
    if (!bodyNode) return null;

    const notifications = bodyNode['notifications'];
    if (!notifications) return null;

    // Notifications could be an array, we only take the first one or assume single for now
    const notification = Array.isArray(notifications['Notification']) ? notifications['Notification'][0] : notifications['Notification'];
    if (!notification) return null;

    const sObject = notification['sObject'];
    if (!sObject) return null;

    const entityType = sObject['@_xsi:type']?.replace('sf:', '');
    const entityId = sObject['sf:Id'] || sObject['sf:id'] || sObject['Id'];

    if (!entityType || !entityId) {
        return null;
    }

    const data: Record<string, string> = {};
    for (const [key, value] of Object.entries(sObject)) {
        if (key.startsWith('sf:') && key !== 'sf:Id' && key !== 'sf:id') {
            const cleanKey = key.replace('sf:', '').toLowerCase();
            data[cleanKey] = typeof value === 'object' ? JSON.stringify(value) : String(value);
        }
    }

    return {
        entityType,
        entityId,
        data,
    };
}
