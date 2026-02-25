/**
 * API client for the Connections / Integrations module.
 * Talks to apps/api /api/connect/* endpoints.
 */

export interface ProviderResponse {
    id: string;
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
    status: 'ACTIVE' | 'INACTIVE' | 'REVOKED' | 'EXPIRED';
    connectionKey: string;
    metadata?: Record<string, unknown>;
    expiresAt?: string;
    createdAt: string;
    credentials?: {
        clientId: string;
        clientSecret: string;
        env?: string;
    };
}

import { apiClient } from '@/shared/lib/api-client';

export async function listProviders(): Promise<ProviderResponse[]> {
    const res = await apiClient.get<ProviderResponse[]>('/connectors/providers');
    return res.data;
}

export async function listActiveConnections(tenantId: string): Promise<ActiveConnectionResponse[]> {
    const res = await apiClient.get<{ data: ActiveConnectionResponse[] }>(`/connectors/active?tenantId=${encodeURIComponent(tenantId)}`);
    return res.data.data;
}

export async function exchangeOAuthCode(payload: {
    providerName: string;
    code: string;
    clientId: string;
    clientSecret: string;
    tenantId: string;
    env?: string;
}): Promise<void> {
    await apiClient.post('/connectors/oauth-exchange', payload);
}
