import {
    createPiece,
    createCustomApiCallAction,
    PieceCategory,
    type ObjectDescriptor,
    type FieldDescriptor,
    type NormalizedRecord,
    type VendorResponse,
    type ConfigOption,
    type RelatedObjectDescriptor,
    type StreamDescriptor,
    type PollWindow,
    type PollPage,
} from '@soopa/piece-framework';


import { salesforceUniversalTrigger } from './lib/trigger/universal-trigger.js';
import { salesforceAuth } from './lib/auth.js';

const SF_API_VERSION = 'v59.0';

class SalesforceFetchError extends Error {
    constructor(
        message: string,
        public readonly status: number,
    ) {
        super(message);
        this.name = 'SalesforceFetchError';
    }
}

function getInstanceUrl(credentials: Record<string, unknown>): string {
    const data = credentials['data'] as Record<string, string> | undefined;
    const url = (credentials['instance_url'] as string) || (data?.instance_url as string);
    if (!url) {
        throw new Error('Salesforce credentials missing instance_url');
    }
    return url.replace(/\/$/, '');
}

function getAccessToken(credentials: Record<string, unknown>): string {
    const token = (credentials['accessToken'] as string) || (credentials['access_token'] as string);
    if (!token) {
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
        throw new SalesforceFetchError(`Salesforce API error ${res.status}: ${body}`, res.status);
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

async function describeRelatedObjects(
    credentials: Record<string, unknown>,
    objectName: string,
): Promise<RelatedObjectDescriptor[]> {
    const instanceUrl = getInstanceUrl(credentials);
    const accessToken = getAccessToken(credentials);
    const url = `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${encodeURIComponent(objectName)}/describe`;

    interface SfDescribeResponse {
        childRelationships: Array<{ childSObject: string; field: string; relationshipName: string | null }>;
        fields: Array<{ type: string; referenceTo?: string[]; name: string; label: string }>;
    }

    // Any 404s here will naturally reject. Valid API names are guaranteed by Orchestrator resolution.
    const data = await sfFetch<SfDescribeResponse>(url, accessToken);

    const related: RelatedObjectDescriptor[] = [];

    // Parent objects (1:1)
    for (const f of data.fields) {
        if (f.type === 'reference' && f.referenceTo?.length) {
            for (const ref of f.referenceTo) {
                related.push({ 
                    objectName: ref, 
                    relationshipType: '1:1', 
                    relationField: f.name,
                    relationLabel: f.label
                });
            }
        }
    }

    // Child objects (1:N)
    for (const cr of data.childRelationships) {
        // Included all child relationships, even those without a relationshipName 
        // (common with managed package objects or implicit relations)
        related.push({ objectName: cr.childSObject, relationshipType: '1:N', relationField: cr.field });
    }

    // Deduplicate
    const unique = new Map<string, RelatedObjectDescriptor>();
    for (const r of related) {
        const key = `${r.objectName}-${r.relationshipType}-${r.relationField}`;
        if (!unique.has(key)) unique.set(key, r);
    }

    return Array.from(unique.values()).sort((a, b) => a.objectName.localeCompare(b.objectName));
}

async function describeConfig(
    _credentials: Record<string, unknown>,
): Promise<ConfigOption[]> {
    return [
        {
            name: 'duplicateStrategy',
            label: 'Duplicate Strategy',
            type: 'select',
            description: 'Determine how to handle records with identical unique identifiers.',
            options: [
                { label: 'Reject Duplicate (Fail row)', value: 'reject' },
                { label: 'Allow Duplicate (Create new)', value: 'allow' },
                { label: 'Update Existing', value: 'update' }
            ],
            defaultValue: 'reject',
        }
    ];
}

async function countRecords(
    credentials: Record<string, unknown>,
    objectName: string,
): Promise<number> {
    const instanceUrl = getInstanceUrl(credentials);
    const accessToken = getAccessToken(credentials);
    const q = encodeURIComponent(`SELECT COUNT() FROM ${objectName}`);
    const url = `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=${q}`;

    interface SfQueryResponse { totalSize: number }
    const data = await sfFetch<SfQueryResponse>(url, accessToken);
    return data.totalSize;
}

async function describeStreams(
    credentials: Record<string, unknown>,
): Promise<StreamDescriptor[]> {
    const objects = await describeObjects(credentials);
    return objects.map((o) => ({
        streamName: o.name,
        // Using FULL_TABLE since not all custom objects support SystemModstamp filtering.
        // Full table pagination is sufficient for the manual initial sync.
        replicationMethod: 'FULL_TABLE',
        keyProperties: ['Id'],
    }));
}

async function poll(
    credentials: Record<string, unknown>,
    streamName: string,
    _window: PollWindow,
    nextPageCursor?: Record<string, unknown>,
): Promise<PollPage> {
    const instanceUrl = getInstanceUrl(credentials);
    const accessToken = getAccessToken(credentials);

    let url: string;
    let soql = `SELECT FIELDS(ALL) FROM ${streamName}`;
    
    if (nextPageCursor && typeof nextPageCursor.lastId === 'string') {
        soql += ` WHERE Id > '${nextPageCursor.lastId}' ORDER BY Id ASC LIMIT 200`;
    } else {
        soql += ` ORDER BY Id ASC LIMIT 200`;
    }
    
    const q = encodeURIComponent(soql);
    url = `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=${q}`;

    interface SfQueryResponse {
        done: boolean;
        records: Record<string, unknown>[];
    }

    const data = await sfFetch<SfQueryResponse>(url, accessToken);

    const done = data.records.length < 200;
    let nextCursor: Record<string, unknown> | undefined;
    if (!done && data.records.length > 0) {
        const lastRecord = data.records[data.records.length - 1];
        nextCursor = { lastId: lastRecord['Id'] };
    }

    return {
        streamName,
        records: data.records.map((r) => ({
            data: r,
            replicationKey: 'Id',
            replicationKeyValue: String(r['Id'] || ''),
        })),
        nextPageCursor: nextCursor,
    };
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
    aliases: [
        {
            name: 'salesforce_revenova',
            displayName: 'Revenova TMS',
            description: 'Connect to Revenova TMS to map loads and stops.',
            category: PieceCategory.OTHER,
            appProfile: 'revenova',
        }
    ],
    actions: [
        customApiAction
    ],
    triggers: [
        salesforceUniversalTrigger
    ],
    describeObjects,
    describeFields,
    describeRelatedObjects,
    describeConfig,
    countRecords,
    describeStreams,
    poll,
    validateConnection: async (tokenResponse: Record<string, unknown>, _vendorParams: Record<string, unknown>, requestedAppProfile: string | undefined): Promise<void> => {
        if (!requestedAppProfile || requestedAppProfile === 'default') {
            return; // No specific managed package required for standard Salesforce
        }

        const instanceUrl = (tokenResponse['instance_url'] as string)?.replace(/\/$/, '');
        const accessToken = tokenResponse['access_token'] as string;

        if (!instanceUrl || !accessToken) {
            throw new Error('Salesforce token response missing instance_url or access_token. Cannot validate connection context.');
        }

        if (requestedAppProfile === 'revenova') {
            // Query both PackageLicense namespaces AND InstalledSubscriberPackage names
            // to robustly detect the Revenova TMS managed package regardless of
            // whether the org uses the 'rtms' namespace or a different identifier.
            const [pkgRes, installedRes] = await Promise.allSettled([
                sfFetch<{ records: Array<{ NamespacePrefix: string }> }>(
                    `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent('SELECT NamespacePrefix FROM PackageLicense')}`,
                    accessToken,
                ),
                sfFetch<{ records: Array<{ SubscriberPackageName: string }> }>(
                    `${instanceUrl}/services/data/${SF_API_VERSION}/tooling/query?q=${encodeURIComponent('SELECT SubscriberPackageName FROM InstalledSubscriberPackage')}`,
                    accessToken,
                ),
            ]);

            // Check if either probe failed, but don't hard fail if it's just an unsupported object
            // as some orgs do not allow querying InstalledSubscriberPackage via REST API.
            if (pkgRes.status === 'rejected') {
                const pkgError = pkgRes.reason instanceof Error ? pkgRes.reason.message : String(pkgRes.reason);
                console.warn(`[salesforce.validateConnection] Failed to query PackageLicense: ${pkgError}`);
            }
            if (installedRes.status === 'rejected') {
                const installedError = installedRes.reason instanceof Error ? installedRes.reason.message : String(installedRes.reason);
                console.warn(`[salesforce.validateConnection] Failed to query InstalledSubscriberPackage: ${installedError}`);
            }

            // Both probes succeeded — now check results
            const namespaces = new Set<string>();
            const packageNames = new Set<string>();

            if (pkgRes.status === 'fulfilled') {
                for (const r of pkgRes.value.records) {
                    if (r.NamespacePrefix) namespaces.add(r.NamespacePrefix.toLowerCase());
                }
            }
            if (installedRes.status === 'fulfilled') {
                for (const r of installedRes.value.records) {
                    if (r.SubscriberPackageName) packageNames.add(r.SubscriberPackageName.toLowerCase());
                }
            }

            const hasRtmsNamespace = namespaces.has('rtms');
            const hasRevenovaPackage = [...packageNames].some(n => n.includes('revenova'));

            console.log(
                `[salesforce.validateConnection] Revenova check — namespaces: [${[...namespaces].join(', ')}], ` +
                `installed packages: [${[...packageNames].join(', ')}], ` +
                `hasRtmsNamespace=${String(hasRtmsNamespace)}, hasRevenovaPackage=${String(hasRevenovaPackage)}`,
            );

            if (!hasRtmsNamespace && !hasRevenovaPackage) {
                if (pkgRes.status === 'rejected' || installedRes.status === 'rejected') {
                    const msg = 'Could not verify Revenova TMS installation due to API errors or insufficient permissions. Please ensure the connected user can query PackageLicense and InstalledSubscriberPackage.';
                    console.error(`[salesforce.validateConnection] ${msg}`);
                    throw new Error(msg);
                }
                const msg =
                    `Connection rejected: Revenova TMS is not installed in this Salesforce organization. ` +
                    `Detected namespaces: [${[...namespaces].join(', ') || 'none'}]. ` +
                    `Installed packages: [${[...packageNames].join(', ') || 'none'}].`;
                console.error(`[salesforce.validateConnection] ${msg}`);
                throw new Error(msg);
            }

            return;
        }

        // Add other domain apps here (e.g., accounting_seed) as they are supported
    },
    normalize: async (_objectType: string, _raw: Record<string, unknown>): Promise<NormalizedRecord | null> => {
        // Returns null — Salesforce records do not map to a pre-defined CanonicalType.
        // NormalizationService (L3) handles null by storing the raw record with
        // canonicalType='RAW'. Field-level mapping is applied in L4 via field_mapping rules.
        return null;
    },
    executeAction: async (objectType: string, payload: Record<string, unknown>, credentials: Record<string, unknown>): Promise<VendorResponse> => {
        // Writes a single record to the Salesforce sObject API.
        // In local/mock mode instanceUrl points to http://mock_gateway:4000/mock/salesforce
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
    executeFetch: async (objectType: string, entityId: string, credentials: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
        const instanceUrl = getInstanceUrl(credentials);
        const accessToken = getAccessToken(credentials);
        const url = `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${encodeURIComponent(objectType)}/${encodeURIComponent(entityId)}`;

        try {
            return await sfFetch<Record<string, unknown>>(url, accessToken);
        } catch (err: unknown) {
            if (err instanceof SalesforceFetchError && err.status === 404) {
                return null;
            }
            throw err;
        }
    },
    executeFind: async (objectType: string, filter: Record<string, unknown>, credentials: Record<string, unknown>): Promise<Record<string, unknown>[]> => {
        const instanceUrl = getInstanceUrl(credentials);
        const accessToken = getAccessToken(credentials);

        // (1) Strict validation: Validate objectType against metadata dictionary
        const objects = await describeObjects(credentials);
        const objectMatch = objects.find((o) => o.name === objectType);
        if (!objectMatch) {
            throw new Error(`Invalid objectType "${objectType}". Object not found in metadata dictionary.`);
        }
        if (!objectMatch.queryable) {
            throw new Error(`Object type "${objectType}" is not queryable. Cannot execute SOQL query against this object.`);
        }

        // (2) Require non-empty filters to avoid broad SELECT queries
        if (!filter || Object.keys(filter).length === 0) {
            throw new Error(`executeFind requires non-empty filters to prevent broad SELECT queries.`);
        }

        // (3) Whitelist filter keys by comparing against object's filterable field metadata
        const fields = await describeFields(credentials, objectType);
        const validFieldNames = new Set(fields.filter((f) => f.filterable).map((f) => f.name));
        const invalidKeys = Object.keys(filter).filter((k) => !validFieldNames.has(k));
        if (invalidKeys.length > 0) {
            throw new Error(`Invalid filter keys for ${objectType}: ${invalidKeys.join(', ')}. Must match filterable field metadata.`);
        }

        // Build a dynamic SOQL WHERE clause based on the validated filters
        const conditions = Object.entries(filter).map(([k, v]) => {
            // Handle different types appropriately for SOQL
            if (v === null || v === undefined) {
                return `${k} = NULL`;
            }
            if (typeof v === 'string') {
                // Escape backslashes first, then single quotes to prevent injection
                const escaped = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                return `${k} = '${escaped}'`;
            }
            if (typeof v === 'number' || typeof v === 'boolean') {
                // Numbers and booleans are interpolated without quotes
                return `${k} = ${v}`;
            }
            // For other types, convert to string and escape
            const strVal = String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return `${k} = '${strVal}'`;
        });
        const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

        // Utilizing FIELDS(ALL) to dynamically hydrate object schema without explicit discovery limits
        const soql = `SELECT FIELDS(ALL) FROM ${objectType}${whereClause} LIMIT 20`;
        const url = `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`;

        interface QueryRes { records: Record<string, unknown>[] }
        const data = await sfFetch<QueryRes>(url, accessToken);
        return data.records || [];
    },
});

export { salesforceAuth } from './lib/auth.js';