import {
    createPiece,
    createCustomApiCallAction,
    PieceCategory
} from '@nexiom/connectors/framework';


import { salesforceUniversalTrigger } from './lib/trigger/universal-trigger.js';
import { salesforceAuth } from './lib/auth.js';



const customApiAction = createCustomApiCallAction({
    baseUrl: (auth) => (auth).data['instance_url'],
    auth: salesforceAuth,
    authMapping: async (auth) => ({
        Authorization: `Bearer ${auth.access_token}`,
    }),
});

export const salesforce = createPiece({
    name: 'salesforce',
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
export { salesforceAuth } from './lib/auth.js';