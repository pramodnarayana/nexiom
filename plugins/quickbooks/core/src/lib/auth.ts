import { PieceAuth, Property } from '@soopa/piece-framework';

export const quickbooksAuth = PieceAuth.OAuth2({
    description: 'You can find Company ID under **settings->Additional Info**.',
    required: true,
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
    extractOrganizationId: (tokens: Record<string, unknown>) => {
        const realmId = tokens.realmId ?? (tokens.data as any)?.realmId;
        return typeof realmId === 'string' ? realmId : undefined;
    }
});
