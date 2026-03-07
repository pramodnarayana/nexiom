import { PieceAuth, Property } from '@nexiom/connectors/framework';

export const quickbooksAuth = PieceAuth.OAuth2({
    description: 'You can find Company ID under **settings->Additional Info**.',
    required: true,
    props: {
        companyId: Property.ShortText({
            displayName: 'Company ID',
            required: true,
        }),
        useSandbox: Property.Checkbox({
            displayName: 'Use Sandbox',
            description: 'Check to use the QuickBooks Sandbox environment',
            required: false,
        }),
    },
    authUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    scope: ['com.intuit.quickbooks.accounting'],
});
