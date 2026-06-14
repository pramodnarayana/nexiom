import type { OAuthCredentialBlob } from '@soopa/credentials';

export type ConnectionValueBlob = OAuthCredentialBlob;

export interface StoreOAuthConnectionOptions {
  id?: string;
  tenantId: string;
  providerName: string;
  externalId: string;
  displayName: string;
  authType: 'OAUTH2' | 'API_KEY' | 'BASIC';
  value: string;
  expiresAt: Date;
  metadata: Record<string, unknown>;
  envType?: 'PRODUCTION' | 'SANDBOX';
  regionContext?: string;
  vendorTenantId?: string;
}

export interface ProvisionInfo {
  schemaName: string;
  dataSourceId: string;
  createdAppConnection: boolean;
}
