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
    else if (payload !== null && typeof payload === 'object' && typeof payload['raw'] === 'string') {
        body = payload['raw'];
    }
    else {
        return null;
    }
    // Salesforce Outbound Message usually looks like:
    // <sObject xsi:type="sf:Account" xmlns:sf="urn:sobject.enterprise.soap.sforce.com">
    //   <sf:Id>001xx000003DGb2AAG</sf:Id>
    //   ...
    // </sObject>
    const typeMatch = body.match(/<sObject[^>]*xsi:type="sf:([^"]+)"/);
    const idMatch = body.match(/<sf:id>([^<]+)<\/sf:id>/i);
    if (!typeMatch || !idMatch) {
        return null;
    }
    const entityType = typeMatch[1];
    const entityId = idMatch[1];
    // Simple key-value extraction for all sf: tags
    // TODO: Replace regex-based extraction with a proper XML parser (e.g., fast-xml-parser or DOMParser)
    // to handle nested nodes, CDATA, and numeric/hex entities correctly.
    const data = {};
    const fieldRegex = /<sf:([a-zA-Z0-9_]+)[^>]*>(.*?)<\/sf:\1>/g;
    let match;
    while ((match = fieldRegex.exec(body)) !== null) {
        const [, key, value] = match;
        // Normalize key to lowercase for consistent downstream access
        // Decode entities in correct order: decode named entities first, then &amp; last to prevent double-decoding
        data[key.toLowerCase()] = value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    }
    return {
        entityType,
        entityId,
        data,
    };
}
