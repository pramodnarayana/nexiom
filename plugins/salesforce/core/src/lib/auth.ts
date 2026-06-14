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
        if (typeof instanceUrl !== 'string' || instanceUrl.trim() === '') {
            throw new Error('Salesforce token response missing or invalid instance_url');
        }
        const accessToken = response.access_token || (response.data as Record<string, unknown> | undefined)?.access_token;
        if (typeof accessToken !== 'string' || accessToken.trim() === '') {
            throw new Error('Salesforce token response missing or invalid access_token');
        }
    },
    extractVendorTenantId: (response: Record<string, unknown>) => {
        // Salesforce returns an 'id' URL in the OAuth token payload, e.g.:
        // https://login.salesforce.com/id/00D5Y0000012345/0055Y0000067890
        // The first ID (00D...) is the Org ID. The second is the User ID.
        const idUrl = response.id || (response.data as Record<string, unknown> | undefined)?.id;
        if (typeof idUrl === 'string') {
            try {
                const url = new URL(idUrl);
                const pathSegments = url.pathname.split('/').filter(s => s.length > 0);
                // Look for the pattern: ['id', '<orgId>', ...] in pathname
                const idIndex = pathSegments.indexOf('id');
                if (idIndex !== -1 && pathSegments.length > idIndex + 1) {
                    const orgId = pathSegments[idIndex + 1];
                    if (orgId) {
                        return orgId;
                    }
                }
            } catch {
                // Invalid URL, return undefined
            }
        }
        return undefined;
    }
});
/* v8 ignore stop */
