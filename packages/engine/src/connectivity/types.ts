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

/** Minimal typed interface for the injected Drizzle DB client. */
export interface DrizzleDb {
    query: {
        appConnections: {
            findFirst(args: Record<string, unknown>): Promise<Record<string, any> | undefined>;
        };
    };
    insert(table: unknown): { values(data: Record<string, unknown>): { onConflictDoUpdate(args: Record<string, unknown>): Promise<unknown> } };
    update(table: unknown): { set(data: Record<string, unknown>): { where(condition: unknown): Promise<unknown> } };
    select(fields?: unknown): {
        from(table: unknown): Promise<Record<string, unknown>[]> & {
            where(condition: unknown): Promise<Record<string, unknown>[]> & { limit(n: number): Promise<Record<string, unknown>[]> };
        }
    };
}
