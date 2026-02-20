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

export interface GenericCredentialType {
    name: string;
    authType: 'OAUTH2' | 'API_KEY';
    oauth?: {
        authorizeUrl: string;
        tokenUrl: string;
        scope?: string[];
    };
    uiSchema?: ConnectorAuthSchema;
}
