import { PieceAuth, Property } from '@nexiom/connectors/framework';

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
        if (!response.instance_url) {
            throw new Error('Salesforce token response missing instance_url');
        }
    }
});
