import { ProviderDefinition } from '../types.js';

/**
 * QuickBooks Online OAuth2 auth config.
 * Source: activepieces-reference/packages/pieces/community/quickbooks/src/index.ts
 */
export const quickbooksProvider: ProviderDefinition = {
    name: 'quickbooks',
    displayName: 'QuickBooks Online',
    description: 'Accounting software for small and medium businesses',
    logoUrl: 'https://cdn.activepieces.com/pieces/quickbooks.png',
    category: 'Accounting',
    authType: 'OAUTH2',
    authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    scopes: ['com.intuit.quickbooks.accounting'],
};
