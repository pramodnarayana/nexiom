import {
    createPiece,
    createCustomApiCallAction,
    PieceCategory,
    type ObjectDescriptor,
    type FieldDescriptor,
    type NormalizedRecord,
    type VendorResponse,
} from '@nexiom/connectors/framework';


import { salesforceUniversalTrigger } from './lib/trigger/universal-trigger.js';
import { salesforceAuth } from './lib/auth.js';

const SF_API_VERSION = 'v59.0';

function getInstanceUrl(credentials: Record<string, unknown>): string {
    const url = credentials['instance_url'];
    if (typeof url !== 'string' || !url) {
        throw new Error('Salesforce credentials missing instance_url');
    }
    return url.replace(/\/$/, '');
}

function getAccessToken(credentials: Record<string, unknown>): string {
    const token = credentials['accessToken'];
    if (typeof token !== 'string' || !token) {
        throw new Error('Salesforce credentials missing accessToken');
    }
    return token;
}

async function sfFetch<T>(url: string, accessToken: string): Promise<T> {
    let res: Response;
    try {
        res = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
        });
    } catch (err: unknown) {
        if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
            throw new Error(`Salesforce API request timed out after 10s: ${url}`);
        }
        throw err;
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Salesforce API error ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
}

async function describeObjects(
    credentials: Record<string, unknown>,
): Promise<ObjectDescriptor[]> {
    const instanceUrl = getInstanceUrl(credentials);
    const accessToken = getAccessToken(credentials);
    const url = `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects`;

    interface SfSobjectsResponse {
        sobjects: Array<{ name: string; label: string; queryable: boolean }>;
    }
    const data = await sfFetch<SfSobjectsResponse>(url, accessToken);

    // Non-queryable custom objects (name.endsWith('__c')) are intentionally included
    // even when queryable === false, to allow field-mapping discovery against custom
    // objects that Salesforce marks non-queryable (e.g., junction/relationship objects).
    // Standard non-queryable objects are excluded because they are typically internal
    // and have no meaningful mapping use case.
    const filtered = data.sobjects.filter((o) => o.queryable || o.name.endsWith('__c'));

    // Custom objects first (sorted by label), then standard objects (sorted by label).
    // This ensures __c objects are never cut off by the MAX_OBJECTS cap in the service layer.
    filtered.sort((a, b) => {
        const aCustom = a.name.endsWith('__c');
        const bCustom = b.name.endsWith('__c');
        if (aCustom !== bCustom) return aCustom ? -1 : 1;
        return a.label.localeCompare(b.label);
    });

    // queryable is preserved in the returned shape so downstream code (e.g., the
    // metadata-discovery service and the mapping canvas) can check the flag and
    // surface a warning or disable query-dependent features for non-queryable objects.
    return filtered.map((o) => ({ name: o.name, label: o.label, queryable: o.queryable }));
}

async function describeFields(
    credentials: Record<string, unknown>,
    objectName: string,
): Promise<FieldDescriptor[]> {
    const instanceUrl = getInstanceUrl(credentials);
    const accessToken = getAccessToken(credentials);
    const url = `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${encodeURIComponent(objectName)}/describe`;

    interface SfField {
        name: string;
        label: string;
        type: string;
        filterable: boolean;
        sortable: boolean;
        nillable: boolean;
        referenceTo?: string[];
    }
    interface SfDescribeResponse { fields: SfField[] }
    const data = await sfFetch<SfDescribeResponse>(url, accessToken);
    return data.fields.map((f) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        filterable: f.filterable,
        sortable: f.sortable,
        nillable: f.nillable,
        ...(f.referenceTo?.length ? { referenceTo: f.referenceTo } : {}),
    }));
}

const customApiAction = createCustomApiCallAction({
    baseUrl: (auth) => (auth).data['instance_url'],
    auth: salesforceAuth,
    authMapping: async (auth) => ({
        Authorization: `Bearer ${auth.access_token}`,
    }),
});

export const salesforce = createPiece({
    name: 'salesforce',
    displayName: 'Salesforce',
    description: 'CRM software solutions and enterprise cloud computing',
    minimumSupportedRelease: '0.30.0',
    logoUrl: 'https://cdn.activepieces.com/pieces/salesforce.png',
    authors: [
        'HKudria',
        'tanoggy',
        'landonmoir',
        'kishanprmr',
        'khaledmashaly',
        'abuaboud',
        'Pranith124',
        'sanket-a11y'
    ],
    categories: [PieceCategory.SALES_AND_CRM],
    auth: salesforceAuth,
    actions: [
        customApiAction
    ],
    triggers: [
        salesforceUniversalTrigger
    ],
    describeObjects,
    describeFields,
    normalize: async (_objectType: string, _raw: Record<string, unknown>): Promise<NormalizedRecord | null> => {
        // Returns null — Salesforce records do not map to a pre-defined CanonicalType.
        // NormalizationService (L3) handles null by storing the raw record with
        // canonicalType='RAW'. Field-level mapping is applied in L4 via field_mapping rules.
        return null;
    },
    executeAction: async (objectType: string, payload: Record<string, unknown>, credentials: Record<string, unknown>): Promise<VendorResponse> => {
        // Writes a single record to the Salesforce sObject API.
        // In local/Prism mode instanceUrl points to localhost:4010.
        // In production it is the org's Salesforce instanceUrl (e.g. https://myorg.salesforce.com).
        const instanceUrl = getInstanceUrl(credentials);
        const accessToken = getAccessToken(credentials);
        const url = `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${encodeURIComponent(objectType)}`;

        let res: Response;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    Accept: 'application/json',
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(15_000),
            });
        } catch (err: unknown) {
            if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
                // Timeout is retryable — the record may not have been written yet
                throw new Error(`Salesforce API request timed out after 15s executing ${objectType}`);
            }
            throw err;
        }

        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        return { statusCode: res.status, body };
    },
    webhook: {
        secretKeyEnv: 'SALESFORCE_WEBHOOK_SECRET',
        signatureHeader: 'X-Salesforce-Signature',
        signatureEncoding: 'base64',
    },
});
export { salesforceAuth } from './lib/auth.js';