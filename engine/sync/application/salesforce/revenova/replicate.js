import { XMLParser } from 'fast-xml-parser';
/**
 * Extracts the core entity from a Revenova (Salesforce) Outbound Message SOAP XML payload.
 */
export async function ReplicateRevenovaObject(payload) {
    // The inbound_gateway stores payloads as { raw: string, contentType: string }.
    // Unwrap the envelope before parsing.
    let body;
    if (typeof payload === 'string') {
        body = payload;
    }
    else if (payload !== null && typeof payload === 'object') {
        const p = payload;
        if (typeof p['raw'] === 'string') {
            body = p['raw'];
        }
        else if (p['attributes'] && typeof p['attributes']['type'] === 'string' && p['Id']) {
            // It's a JSON REST API payload from polling!
            const entityType = p['attributes']['type'];
            const entityId = p['Id'];
            // Normalize keys to lowercase to match the XML extraction behavior downstream
            const data = {};
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
        }
        else {
            return null;
        }
    }
    else {
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
    let parsed;
    try {
        parsed = parser.parse(body);
    }
    catch (err) {
        return null;
    }
    // Navigate to the sObject node inside the Envelope -> Body -> notifications -> Notification -> sObject
    const envelope = parsed['soapenv:Envelope'] || parsed['Envelope'];
    if (!envelope)
        return null;
    const bodyNode = envelope['soapenv:Body'] || envelope['Body'];
    if (!bodyNode)
        return null;
    const notifications = bodyNode['notifications'];
    if (!notifications)
        return null;
    // Handle arrays explicitly: process all notifications
    const notificationArray = Array.isArray(notifications['Notification'])
        ? notifications['Notification']
        : [notifications['Notification']];

    if (notificationArray.length === 0)
        return null;

    // Process multiple notifications (batched webhooks)
    const results = [];
    for (const notification of notificationArray) {
        if (!notification)
            continue;
        const sObject = notification['sObject'];
        if (!sObject)
            continue;
        const entityType = sObject['@_xsi:type']?.replace('sf:', '');
        const entityId = sObject['sf:Id'] || sObject['sf:id'] || sObject['Id'];
        if (!entityType || !entityId) {
            continue;
        }
        const data = {};
        for (const [key, value] of Object.entries(sObject)) {
            if (key.startsWith('sf:') && key !== 'sf:Id' && key !== 'sf:id') {
                const cleanKey = key.replace('sf:', '').toLowerCase();
                data[cleanKey] = typeof value === 'object' ? JSON.stringify(value) : String(value);
            }
        }
        results.push({
            entityType,
            entityId,
            data,
        });
    }
    // Return first result for backward compatibility (or extend API to return array)
    return results.length > 0 ? results[0] : null;
}
