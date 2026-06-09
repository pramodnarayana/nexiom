/* v8 ignore start */
import { PieceAuth, Property } from '@soopa/piece-framework';

export const salesforceAuth = PieceAuth.OAuth2({
    description: 'Connect your Salesforce account',
    authUrl: 'https://{environment}.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://{environment}.salesforce.com/services/oauth2/token',
    required: true,
    scope: ['api', 'refresh_token', 'offline_access'],
    props: {
        environment: Property.StaticDropdown({
            displayName: 'Environment',
            description: 'Choose your Salesforce environment',
            required: true,
            defaultValue: 'login',
            options: {
                options: [
                    { label: 'Production', value: 'login' },
                    { label: 'Sandbox', value: 'test' }
                ]
            }
        })
    },
    validateConnectResponse: (response: Record<string, unknown>) => {
        const instanceUrl = response.instance_url || (response.data as Record<string, unknown> | undefined)?.instance_url;
        if (!instanceUrl) {
            throw new Error('Salesforce token response missing instance_url');
        }
        const accessToken = response.access_token || (response.data as Record<string, unknown> | undefined)?.access_token;
        if (!accessToken) {
            throw new Error('Salesforce token response missing access_token');
        }
    }
});
/* v8 ignore stop */
