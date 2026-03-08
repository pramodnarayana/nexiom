/** Auth types supported by Nexiom providers. */
export type AuthType = 'OAUTH2' | 'API_KEY' | 'BASIC';

interface BaseProviderDefinition {
    /** Unique slug used as the key in PROVIDER_REGISTRY and stored in app_credential.app_name */
    name: string;
    displayName: string;
    description: string;
    logoUrl: string;
    category: string;
    /**
     * Dynamically exposed JSON Schema (e.g. piece auth properties).
     * TODO: Replace `Record<string, any>` with a dedicated `UiSchemaProp` or `JsonSchema`
     * interface once this pattern is used across more providers, to improve type safety
     * at all call sites that read/write uiSchema fields.
     */
    uiSchema?: Record<string, unknown>;
}

export interface ProviderEnvironment {
    /** Internal programmatic identifier (e.g., 'production', 'sandbox') */
    name: string;
    /** User-facing label (e.g., 'Production (login.salesforce.com)') */
    displayName: string;
    authorizeUrl: string;
    tokenUrl: string;
}

export interface OAuth2Provider extends BaseProviderDefinition {
    authType: 'OAUTH2';
    /** Optional explicit environments. If provided, authorizeUrl/tokenUrl at the root level become fallbacks. */
    environments?: ProviderEnvironment[];
    /** Default or Fallback OAuth2 Authorization endpoint */
    authorizeUrl: string;
    /** OAuth2 Token exchange endpoint */
    tokenUrl: string;
    /** OAuth2 scopes requested during authorization */
    scopes: string[];
    /** 
     * Optional validation function to verify vendor-specific fields in the token response.
     * @throws AppCredentialError if validation fails
     */
    validateConnectResponse?: (response: Record<string, unknown>) => void;
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
