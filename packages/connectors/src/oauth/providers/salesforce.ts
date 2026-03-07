import { ProviderDefinition } from '../types.js';
import { AppCredentialError } from '../token-manager.service.js';
/**
 * Salesforce OAuth2 auth config.
 * Source: activepieces-reference/packages/pieces/community/salesforce/src/index.ts
 */
export const salesforceProvider: ProviderDefinition = {
    name: 'salesforce',
    displayName: 'Salesforce',
    description: 'CRM software solutions and enterprise cloud computing',
    logoUrl: 'https://cdn.activepieces.com/pieces/salesforce.png',
    category: 'CRM',
    authType: 'OAUTH2',
    environments: [
        {
            name: 'production',
            displayName: 'Production (login.salesforce.com)',
            authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
            tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
        },
        {
            name: 'sandbox',
            displayName: 'Sandbox (test.salesforce.com)',
            authorizeUrl: 'https://test.salesforce.com/services/oauth2/authorize',
            tokenUrl: 'https://test.salesforce.com/services/oauth2/token',
        },
    ],
    // Defaults back to production if no env is specified programmatically
    authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    scopes: ['refresh_token', 'full', 'api'],
    validateConnectResponse: (response: Record<string, unknown>) => {
        if (!response.instance_url) {
            throw new AppCredentialError('Missing required "instance_url" in Salesforce OAuth response. Ensure the environment and permissions are correct.');
        }
    },
};
