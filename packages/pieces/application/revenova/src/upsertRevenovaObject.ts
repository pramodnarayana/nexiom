import type { ReplicaExtractorFn } from '@nexiom/piece-framework';

interface SalesforceEnvelope {
    notification?: {
        sobject?: Record<string, unknown>;
    };
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
        rawObj = payload as Record<string, unknown>;
    }

    const r_obj: Record<string, unknown> = {};
    let doctype = 'DEFAULT';

    // 2. Sanitize keys (remove "sf:") and extract doctype
    for (const [key, value] of Object.entries(rawObj)) {
        if (key !== '$') {
            const cleanKey = key.startsWith('sf:') ? key.substring(3) : key;
            r_obj[cleanKey] = value;
        } else {
            // Extrapolate doctype from SOAP schema definitions if available
            const xsi = (value as Record<string, unknown>)?.['xsi:type'];
            if (typeof xsi === 'string') {
                const typeName = xsi.startsWith('sf:') ? xsi.substring(3) : xsi;
                doctype = typeName.startsWith('rtms__') ? typeName : `sf_${typeName}`;
            }
        }
    }

    // 3. Simple canonical cleanup (name -> name_)
    // Check both lowercase and PascalCase variants (Salesforce fields can be either)
    if (r_obj.name !== undefined || r_obj.Name !== undefined) {
        r_obj.name_ = r_obj.name ?? r_obj.Name;
        delete r_obj.name;
        delete r_obj.Name;
    }

    return {
        entityType: doctype,
        data: r_obj
    };
};