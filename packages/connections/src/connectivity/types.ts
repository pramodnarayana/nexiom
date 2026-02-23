import { db } from '@nexiom/database';

/** The actual inferred type of the Drizzle Postgres client. */
export type DrizzleDb = typeof db;

/** Auth types supported by Nexiom providers. */
export type AuthType = 'OAUTH2' | 'API_KEY' | 'BASIC';

interface BaseProviderDefinition {
    /** Unique slug used as the key in PROVIDER_REGISTRY and stored in app_credential.app_name */
    name: string;
    displayName: string;
    description: string;
    logoUrl: string;
    category: string;
}

export interface OAuth2Provider extends BaseProviderDefinition {
    authType: 'OAUTH2';
    /** OAuth2 Authorization endpoint */
    authorizeUrl: string;
    /** OAuth2 Token exchange endpoint */
    tokenUrl: string;
    /** OAuth2 scopes requested during authorization */
    scopes: string[];
}

export interface ApiKeyProvider extends BaseProviderDefinition {
    authType: 'API_KEY';
}

export interface BasicProvider extends BaseProviderDefinition {
    authType: 'BASIC';
}

/**
 * Code-first provider definition — the single source of truth for
 * all provider OAuth configuration. No DB table required.
 */
export type ProviderDefinition = OAuth2Provider | ApiKeyProvider | BasicProvider;
