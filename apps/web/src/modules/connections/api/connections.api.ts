/**
 * API client for the Connections / Integrations module.
 * Talks to apps/api /api/connectors/* endpoints.
 */

import { apiClient } from "@/shared/lib/api-client";

export interface ProviderResponse {
    name: string;
    displayName: string;
    authType: 'OAUTH2' | 'API_KEY' | 'BASIC';
    description?: string;
    logoUrl?: string;
    category?: string;
    environments?: {
        name: string;
        displayName: string;
    }[];
    scopes?: string[];
    uiSchema?: Record<string, unknown>;
}

export interface ActiveConnectionResponse {
    id: string;
    appName: string;
    /** User-defined kebab slug e.g. "salesforce-tms" */
    externalId: string;
    /** Human-readable label e.g. "TMS Salesforce" */
    displayName: string;
    authType: 'OAUTH2' | 'API_KEY' | 'BASIC';
    status: 'ACTIVE' | 'INACTIVE' | 'REVOKED' | 'EXPIRED';
    hasCredentials?: boolean;
    metadata?: Record<string, unknown>;
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

export async function getConnectionCredentials(connectionId: string): Promise<{ clientId: string; clientSecret: string }> {
    const res = await apiClient.get<{ clientId: string; clientSecret: string }>(`/connectors/active/${connectionId}/credentials`);
    return res.data;
}

export async function exchangeOAuthCode(payload: {
    providerName: string;
    code: string;
    state: string;
    vendorParams?: Record<string, string>;
    clientId: string;
    clientSecret?: string;
    /** Human-readable name for this connection e.g. "TMS Salesforce" */
    displayName: string;
    env?: string;
}): Promise<void> {
    await apiClient.post('/connectors/oauth-exchange', payload);
}
