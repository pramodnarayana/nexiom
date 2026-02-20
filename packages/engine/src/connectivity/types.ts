export interface ConnectorAuthSchema {
    type: 'object';
    properties: Array<{
        name: string;
        label: string;
        type: 'shortText' | 'secretText' | 'dropdown' | 'oauth2';
        required: boolean;
        description?: string;
        options?: Array<{ label: string; value: string }>;
    }>;
}

interface OAuthConfig {
    authorizeUrl: string;
    tokenUrl: string;
    scope?: string[];
}
interface BaseCredentialType {
    name: string;
    uiSchema?: ConnectorAuthSchema;
}
export type GenericCredentialType =
    | (BaseCredentialType & { authType: 'OAUTH2'; oauth: OAuthConfig })
    | (BaseCredentialType & { authType: 'API_KEY' });
