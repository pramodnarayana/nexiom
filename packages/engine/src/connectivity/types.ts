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

interface BaseCredentialType {
    name: string;
    uiSchema?: ConnectorAuthSchema;
}

/** Shape of OAuth config as stored in the `providers` DB table. */
export interface OAuthConfig {
    authorizeUrl: string;
    tokenUrl: string;
    scopes?: string[];
}

// GenericCredentialType defines integration-package seed data.
// OAuth URLs live in the providers table, not in integration configs.
export type GenericCredentialType =
    | (BaseCredentialType & { authType: 'OAUTH2' })
    | (BaseCredentialType & { authType: 'API_KEY' });

import { db } from '@nexiom/database';

/** The actual inferred type of the Drizzle Postgres client. */
export type DrizzleDb = typeof db;
