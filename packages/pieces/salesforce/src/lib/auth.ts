import { PieceAuth } from '@nexiom/connectors/framework';

export const salesforceAuth = PieceAuth.OAuth2({
    description: 'Connect your Salesforce account',
    authUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    required: true,
    scope: ['api', 'refresh_token', 'offline_access'],
});
