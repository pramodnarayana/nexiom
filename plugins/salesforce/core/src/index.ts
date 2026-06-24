import {
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
import { NativeFetchAdapter, SalesforceFetchError } from './adapters/native-fetch.adapter.js';
import { SalesforceUseCases } from './use-cases/salesforce.use-cases.js';
import { SalesforceCredentials } from './domain/salesforce-credentials.value.js';


import * as frameworkApi from '@soopa/piece-framework';

export interface SalesforcePieceConfig {
    name: string;
    displayName: string;
    description: string;
    logoUrl: string;
    categories: PieceCategory[];
    appProfile?: string;
    migrationsFolder?: string;
    appHooks?: import('@soopa/piece-framework').PluginPipelineHooks;
}

export function createSalesforcePiece(config: SalesforcePieceConfig): import('@soopa/piece-framework').Piece {
    const SF_API_VERSION = 'v59.0';
    const httpAdapter = new NativeFetchAdapter();
    const useCases = new SalesforceUseCases(httpAdapter);

    async function describeObjects(credentialsRecord: Record<string, unknown>): Promise<ObjectDescriptor[]> {
        return useCases.describeObjects(SalesforceCredentials.fromRecord(credentialsRecord));
    }

    async function describeFields(credentialsRecord: Record<string, unknown>, objectName: string): Promise<FieldDescriptor[]> {
        return useCases.describeFields(SalesforceCredentials.fromRecord(credentialsRecord), objectName);
    }

    async function describeRelatedObjects(credentialsRecord: Record<string, unknown>, objectName: string): Promise<RelatedObjectDescriptor[]> {
        return useCases.describeRelatedObjects(SalesforceCredentials.fromRecord(credentialsRecord), objectName);
    }

    async function countRecords(credentialsRecord: Record<string, unknown>, objectName: string): Promise<number> {
        return useCases.countRecords(SalesforceCredentials.fromRecord(credentialsRecord), objectName);
    }

    async function describeStreams(credentialsRecord: Record<string, unknown>): Promise<StreamDescriptor[]> {
        return useCases.describeStreams(SalesforceCredentials.fromRecord(credentialsRecord));
    }

    async function poll(credentialsRecord: Record<string, unknown>, streamName: string, window: PollWindow, nextPageCursor?: Record<string, unknown>): Promise<PollPage> {
        return useCases.poll(SalesforceCredentials.fromRecord(credentialsRecord), streamName, window, nextPageCursor);
    }

    async function describeConfig(_credentials: Record<string, unknown>): Promise<ConfigOption[]> {
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

    const customApiAction = frameworkApi.createCustomApiCallAction({
        baseUrl: (auth: Record<string, unknown>) => {
            const data = auth['data'] as Record<string, unknown> | undefined;
            return (data?.['instance_url'] as string) || (auth['instance_url'] as string);
        },
        auth: salesforceAuth,
        authMapping: async (auth: Record<string, unknown>) => ({
            Authorization: `Bearer ${auth['access_token']}`,
        }),
    });

    return frameworkApi.createPiece({
        name: config.name,
        displayName: config.displayName,
        description: config.description,
        minimumSupportedRelease: '0.30.0',
        logoUrl: config.logoUrl,
        authors: [
            'HKudria',
            'tanoggy',
            'landonmoir',
            'kishanprmr',
            'khaledmashaly',
            'abuaboud',
            'Pranith124',
            'sanket-a11y',
            'soopa'
        ],
        categories: config.categories,
        auth: salesforceAuth,
        actions: [
            customApiAction
        ],
        triggers: [
            salesforceUniversalTrigger
        ],
        migrationsFolder: config.migrationsFolder,
        appHooks: config.appHooks,
        describeObjects,
        describeFields,
        describeRelatedObjects,
        describeConfig,
        countRecords,
        describeStreams,
        poll,
        validateConnection: async (tokenResponse: Record<string, unknown>, _vendorParams: Record<string, unknown>, requestedAppProfile: string | undefined): Promise<void> => {
            const profileToValidate = requestedAppProfile || config.appProfile;
            if (!profileToValidate || profileToValidate === 'default') {
                return;
            }

            const creds = SalesforceCredentials.fromRecord(tokenResponse);

            if (profileToValidate === 'revenova') {
                const pkgQuery = encodeURIComponent('SELECT NamespacePrefix FROM PackageLicense');
                const installedQuery = encodeURIComponent('SELECT SubscriberPackageName FROM InstalledSubscriberPackage');

                const [pkgRes, installedRes] = await Promise.allSettled([
                    httpAdapter.get<{ records: Array<{ NamespacePrefix: string }> }>(
                        `${creds.instanceUrl}/services/data/${SF_API_VERSION}/query?q=${pkgQuery}`,
                        { Authorization: `Bearer ${creds.accessToken}`, Accept: 'application/json' }
                    ),
                    httpAdapter.get<{ records: Array<{ SubscriberPackageName: string }> }>(
                        `${creds.instanceUrl}/services/data/${SF_API_VERSION}/tooling/query?q=${installedQuery}`,
                        { Authorization: `Bearer ${creds.accessToken}`, Accept: 'application/json' }
                    ),
                ]);

                const namespaces = new Set<string>();
                const packageNames = new Set<string>();

                if (pkgRes.status === 'fulfilled') {
                    for (const r of pkgRes.value.data.records) {
                        if (r.NamespacePrefix) namespaces.add(r.NamespacePrefix.toLowerCase());
                    }
                } else {
                    console.warn(`[salesforce.validateConnection] Failed to query PackageLicense: ${pkgRes.reason}`);
                }

                if (installedRes.status === 'fulfilled') {
                    for (const r of installedRes.value.data.records) {
                        if (r.SubscriberPackageName) packageNames.add(r.SubscriberPackageName.toLowerCase());
                    }
                } else {
                    console.warn(`[salesforce.validateConnection] Failed to query InstalledSubscriberPackage: ${installedRes.reason}`);
                }

                const hasRtmsNamespace = namespaces.has('rtms');
                const hasRevenovaPackage = [...packageNames].some(n => n.includes('revenova'));

                if (!hasRtmsNamespace && !hasRevenovaPackage) {
                    if (pkgRes.status === 'rejected' || installedRes.status === 'rejected') {
                        throw new Error('Could not verify Revenova TMS installation due to API errors or insufficient permissions. Please ensure the connected user can query PackageLicense and InstalledSubscriberPackage.');
                    }
                    throw new Error(`Connection rejected: Revenova TMS is not installed in this Salesforce organization. Detected namespaces: [${[...namespaces].join(', ') || 'none'}]. Installed packages: [${[...packageNames].join(', ') || 'none'}].`);
                }
            }
        },
        normalize: async (_objectType: string, _raw: Record<string, unknown>): Promise<NormalizedRecord | null> => {
            return null;
        },
        executeAction: async (objectType: string, payload: Record<string, unknown>, credentialsRecord: Record<string, unknown>): Promise<VendorResponse> => {
            const creds = SalesforceCredentials.fromRecord(credentialsRecord);
            const url = `${creds.instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${encodeURIComponent(objectType)}`;

            try {
                const { status, data } = await httpAdapter.post<Record<string, unknown>>(url, {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${creds.accessToken}`,
                    Accept: 'application/json',
                }, payload);

                return { statusCode: status, body: data };
            } catch (err: unknown) {
                if (err instanceof SalesforceFetchError) {
                    let parsedBody: unknown = {};
                    try {
                        // Try to find JSON payload in the error message
                        const braceIndex = err.message.search(/[{[]/);
                        if (braceIndex !== -1) {
                            parsedBody = JSON.parse(err.message.substring(braceIndex));
                        }
                    } catch {
                        // Ignore
                    }
                    return { statusCode: err.status, body: parsedBody as Record<string, unknown> };
                }
                throw err;
            }
        },
        executeFetch: async (objectType: string, entityId: string, credentialsRecord: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
            const creds = SalesforceCredentials.fromRecord(credentialsRecord);
            const url = `${creds.instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${encodeURIComponent(objectType)}/${encodeURIComponent(entityId)}`;

            try {
                const { data } = await httpAdapter.get<Record<string, unknown>>(url, {
                    Authorization: `Bearer ${creds.accessToken}`,
                    Accept: 'application/json',
                });
                return data;
            } catch (err: unknown) {
                if (err instanceof SalesforceFetchError && err.status === 404) {
                    return null;
                }
                throw err;
            }
        },
        executeFind: async (objectType: string, filter: Record<string, unknown>, credentialsRecord: Record<string, unknown>): Promise<Record<string, unknown>[]> => {
            return useCases.executeFind(SalesforceCredentials.fromRecord(credentialsRecord), objectType, filter);
        },
    });
}

export function register(): import('@soopa/piece-framework').Piece {
    return createSalesforcePiece({
        name: 'salesforce',
        displayName: 'Salesforce',
        description: 'CRM software solutions and enterprise cloud computing',
        logoUrl: 'https://cdn.activepieces.com/pieces/salesforce.png',
        categories: [PieceCategory.SALES_AND_CRM]
    });
}

export { salesforceAuth } from './lib/auth.js';