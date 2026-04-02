import { PieceAuth, Property } from '@nexiom/piece-framework';

export const quickbooksAuth = PieceAuth.OAuth2({
    description: 'You can find Company ID under **settings->Additional Info**.',
    required: true,
    props: {
        companyId: Property.ShortText({
            displayName: 'Company ID',
            required: true,
        }),
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
                        label: 'Sandbox',
                        value: 'test',
                    },
                ],
            },
            defaultValue: 'login',
        }),
    },
    authUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    scope: ['com.intuit.quickbooks.accounting'],
});
