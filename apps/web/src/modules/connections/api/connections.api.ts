/**
 * API client for the Connections / Integrations module.
 * Talks to apps/api /api/connectors/* endpoints.
 */

import { apiClient } from "@/shared/lib/api-client";

export interface ProviderResponse {
    name: string;
    displayName: string;
    authType: string;
    description?: string;
    logoUrl?: string;
    category?: string;
    scopes?: string[];
    /**
     * Vendor-specific input schema derived from piece.auth.props.
     * Rendered generically by DynamicAuthForm as dropdown/text/checkbox fields.
     */
    uiSchema?: Record<string, unknown>;
}

/** 
 * Represents all vendor-specific form values (e.g. environment selection) 
 * submitted during the OAuth flow.
 */
export type VendorParams = Record<string, string | boolean | number>;

export interface ActiveConnectionResponse {
    id: string;
    appName: string;
    /** User-defined kebab slug e.g. "salesforce-tms" */
    externalId: string;
    /** Human-readable label e.g. "TMS Salesforce" */
    displayName: string;
    authType: 'OAUTH2' | 'API_KEY' | 'BASIC';
    status: 'ACTIVE' | 'INACTIVE' | 'REVOKED' | 'EXPIRED';
    envType: 'PRODUCTION' | 'SANDBOX';
    hasCredentials?: boolean;
    metadata?: Record<string, unknown>;
    organizationId?: string;
    webhookUrl?: string;
    expiresAt?: string;
    createdAt: string;
}

export async function listProviders(): Promise<ProviderResponse[]> {
    const res = await apiClient.get<ProviderResponse[]>('/connectors/providers');
    return res.data;
}

export async function listActiveConnections(): Promise<ActiveConnectionResponse[]> {
    const res = await apiClient.get<{ data: ActiveConnectionResponse[] }>('/connectors/active');
    return res.data.data;
}

/**
 * Fetches existing credentials for a connection to pre-fill the reconnect/update form.
 *
 * NOTE: clientSecret is intentionally never returned — the backend holds it
 * server-side. `hasClientSecret` indicates whether one is stored.
 */
export async function getConnectionCredentials(dataSourceId: string): Promise<{
    clientId: string;
    hasClientSecret: boolean;
    vendorParams?: VendorParams;
}> {
    const res = await apiClient.get<{
        clientId: string;
        hasClientSecret: boolean;
        vendorParams?: VendorParams;
    }>(`/connectors/active/${dataSourceId}/credentials`);
    return res.data;
}

export async function createOAuthSession(payload: {
    providerName: string;
    clientId: string;
    vendorParams?: VendorParams;
}): Promise<{ sessionId: string }> {
    const res = await apiClient.post<{ sessionId: string }>(`/connectors/${payload.providerName}/session`, {
        providerName: payload.providerName,
        clientId: payload.clientId,
        vendorParams: payload.vendorParams,
    });
    return res.data;
}


export async function exchangeOAuthCode(payload: {
    providerName: string;
    code: string;
    state: string;
    vendorParams?: VendorParams;
    clientId: string;
    /** Optional — omit to use the server-persisted secret (reconnect/update without rotation) */
    clientSecret?: string;
    /** Human-readable name for this connection e.g. "TMS Salesforce" */
    displayName: string;
    dataSourceId?: string;
}): Promise<void> {
    await apiClient.post('/connectors/oauth-exchange', payload);
}

export async function deleteConnection(dataSourceId: string): Promise<void> {
    await apiClient.delete(`/connectors/${dataSourceId}`);
}

export async function updateConnectionDisplayName(dataSourceId: string, displayName: string): Promise<void> {
    await apiClient.patch(`/connectors/${dataSourceId}`, { displayName });
}