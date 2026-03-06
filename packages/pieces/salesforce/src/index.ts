import {
    PieceAuth,
    Property,
    createPiece,

    createCustomApiCallAction,
    PieceCategory
} from '@nexiom/connectors/framework';


import { salesforceUniversalTrigger } from './lib/trigger/universal-trigger.js';

export const salesforceAuth = PieceAuth.OAuth2({
    props: {
        environment: Property.StaticDropdown({
            displayName: 'Environment',
            description: 'Choose environment',
            required: true,
            options: {
                options: [
                    {
                        label: 'Production',
                        value: 'login',
                    },
                    {
                        label: 'Development',
                        value: 'test',
                    },
                ],
            },
            defaultValue: 'login',
        }),
    },
    required: true,
    description: 'Authenticate with Salesforce Production',
    authUrl: 'https://{environment}.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://{environment}.salesforce.com/services/oauth2/token',
    scope: ['refresh_token', 'full', 'api'],
});

const customApiAction = createCustomApiCallAction({
    baseUrl: (auth) => (auth).data['instance_url'],
    auth: salesforceAuth,
    authMapping: async (auth) => ({
        Authorization: `Bearer ${(auth).access_token}`,
    }),
});

export const salesforce = createPiece({
    displayName: 'Salesforce',
    description: 'CRM software solutions and enterprise cloud computing',
    minimumSupportedRelease: '0.30.0',
    logoUrl: 'https://cdn.activepieces.com/pieces/salesforce.png',
    authors: [
        'HKudria',
        'tanoggy',
        'landonmoir',
        'kishanprmr',
        'khaledmashaly',
        'abuaboud',
        'Pranith124',
        'sanket-a11y'
    ],
    categories: [PieceCategory.SALES_AND_CRM],
    auth: salesforceAuth,
    actions: [
        customApiAction
    ],
    triggers: [
        salesforceUniversalTrigger
    ],
});