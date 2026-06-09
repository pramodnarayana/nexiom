import { AnyProperty, PropertyType } from './property.js';

/**
 * Resolves `{key}` template tokens in an OAuth2 URL using vendorParam values.
 *
 * Example:
 *   resolveOAuth2Url(
 *     'https://{environment}.salesforce.com/services/oauth2/authorize',
 *     { environment: 'test' }
 *   )
 *   // => 'https://test.salesforce.com/services/oauth2/authorize'
 *
 * Throws if a placeholder present in the template has no corresponding vendor param.
 */
export function resolveOAuth2Url(
    template: string,
    vendorParams?: Record<string, string>,
): string {
    const params = vendorParams ?? {};
    return template.replaceAll(/\{([^}]+)\}/g, (_match, key: string) => {
        const value = params[key];
        if (value === undefined || value === '') {
            throw new Error(
                `OAuth2 URL template references prop "${key}" but no value was provided in vendorParams`,
            );
        }
        if (/[@/?#:]/.test(value)) {
            throw new Error(
                `OAuth2 URL template prop "${key}" contains unsafe characters that could alter the URL structure.`,
            );
        }
        return value;
    });
}

export type OAuth2GrantType = 'AUTHORIZATION_CODE' | 'CLIENT_CREDENTIALS';

export interface OAuth2Auth {
    type: PropertyType.OAUTH2;
    required: boolean;
    description?: string;
    props?: Record<string, AnyProperty>;
    authUrl: string;
    tokenUrl: string;
    scope: string[];
    grantType?: OAuth2GrantType;
    /**
     * Optional piece-level validation of the vendor token exchange response.
     * Called after a successful token exchange to verify vendor-specific required fields
     * (e.g. Salesforce requires `instance_url`).
     * @throws Error if the response is missing required fields.
     */
    validateConnectResponse?: (response: Record<string, unknown>) => void;
}

export interface CustomAuth {
    type: PropertyType.CUSTOM_AUTH;
    required: boolean;
    props: Record<string, AnyProperty>;
}

export interface SecretTextAuth {
    type: PropertyType.SECRET_TEXT;
    required: boolean;
    displayName: string;
    description?: string;
}

export type PieceAuthProperty = OAuth2Auth | CustomAuth | SecretTextAuth;

/**
 * Mocks the exact Activepieces PieceAuth namespace.
 * Describes how the app expects to authenticate with our native OAuth system.
 */
export const PieceAuth = {
    OAuth2(request: Omit<OAuth2Auth, 'type'>): OAuth2Auth {
        return { ...request, type: PropertyType.OAUTH2 };
    },
    CustomAuth(request: Omit<CustomAuth, 'type'>): CustomAuth {
        return { ...request, type: PropertyType.CUSTOM_AUTH };
    },
    SecretText(request: Omit<SecretTextAuth, 'type'>): SecretTextAuth {
        return { ...request, type: PropertyType.SECRET_TEXT };
    },
};
