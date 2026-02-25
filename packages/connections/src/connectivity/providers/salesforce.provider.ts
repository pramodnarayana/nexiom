import { ProviderDefinition } from '../types.js';

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
    authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    scopes: ['refresh_token', 'full', 'api'],
};
