import type { ReplicaExtractorFn } from '@nexiom/piece-framework';

export const upsertRevenovaObject: ReplicaExtractorFn = (payload) => {
    if (!payload || typeof payload !== 'object') return null;

    // Mimic the Python unwrapping behavior
    // 1. Dig through Salesforce outbound message envelope if present
    let rawObj = payload as any;
    if (rawObj.notification && rawObj.notification.sobject) {
        rawObj = rawObj.notification.sobject;
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
            const xsi = (value as any)?.['xsi:type'] as string;
            if (xsi) {
                const typeName = xsi.startsWith('sf:') ? xsi.substring(3) : xsi;
                doctype = typeName.startsWith('rtms__') ? typeName : `sf_${typeName}`;
            }
        }
    }

    // 3. Simple canonical cleanup (name -> name_)
    if (r_obj.name) {
        r_obj.name_ = r_obj.name;
        delete r_obj.name;
    }

    return {
        entityType: doctype,
        data: r_obj
    };
};
