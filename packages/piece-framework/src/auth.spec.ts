import { resolveOAuth2Url } from './auth.js';
import { describe, it, expect } from 'vitest';

describe('resolveOAuth2Url', () => {
    it('should return the template unaltered if no handlebars are present', () => {
        const template = 'https://login.example.com/oauth2/v1/authorize';
        const result = resolveOAuth2Url(template, { env: 'sandbox', custom: '123' });
        expect(result).toBe('https://login.example.com/oauth2/v1/authorize');
    });

    it('should resolve placeholders using vendorParams', () => {
        const template = 'https://{env}.example.com/oauth2/{version}/authorize';
        const result = resolveOAuth2Url(template, { env: 'sandbox', version: 'v2' });
        expect(result).toBe('https://sandbox.example.com/oauth2/v2/authorize');
    });

    it('should throw an error for unmatched placeholders', () => {
        const template = 'https://{missing}.example.com/oauth2/authorize';
        expect(() => resolveOAuth2Url(template, { env: 'sandbox' })).toThrowError(
            'OAuth2 URL template references prop "missing" but no value was provided in vendorParams'
        );
    });

    it('should handle undefined vendorParams gracefully', () => {
        const template = 'https://login.example.com/oauth2/authorize';
        const result = resolveOAuth2Url(template);
        expect(result).toBe('https://login.example.com/oauth2/authorize');
    });

    it('should throw an error when unsafe characters are passed in vendorParams', () => {
        const template = 'https://{tenant}.example.com';
        expect(() => resolveOAuth2Url(template, { tenant: 'bad@/?:#' })).toThrowError(
            'OAuth2 URL template prop "tenant" contains unsafe characters that could alter the URL structure.'
        );
    });

    it('should handle flat keys seamlessly', () => {
        const template = 'https://{tenant}.api.example.com/{version}';
        const result = resolveOAuth2Url(template, { tenant: 'acme', version: 'v3' });
        expect(result).toBe('https://acme.api.example.com/v3');
    });
});
