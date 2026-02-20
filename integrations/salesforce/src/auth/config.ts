import { GenericCredentialType } from '@nexiom/engine/src/connectivity/types';

export const salesforceAuth: GenericCredentialType = {
    name: 'salesforce',
    authType: 'OAUTH2',
    oauth: {
        authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
        scope: ['api', 'refresh_token', 'offline_access'],
    },
    uiSchema: {
        type: 'object',
        properties: [
            {
                name: 'clientId',
                label: 'Client ID',
                type: 'shortText',
                required: true,
            },
            {
                name: 'clientSecret',
                label: 'Client Secret',
                type: 'secretText',
                required: true,
            },
        ],
    },
};
