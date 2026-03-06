import { AnyProperty, PropertyType } from './property.js';

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
