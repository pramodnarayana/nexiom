import { defineAccessControlFor } from './access-control';
import { describe, it, expect } from 'vitest';

describe('AccessControlFactory', () => {
    it('hydrates simple permissions', () => {
        const ability = defineAccessControlFor({
            permissions: ['User:read']
        });
        expect(ability.can('read', 'User')).toBe(true);
        expect(ability.cannot('delete', 'User')).toBe(true);
    });

    it('hydrates JSON rules with conditions', () => {
        const condition = { role: { $ne: 'owner' } };
        const ability = defineAccessControlFor({
            permissions: [{
                action: 'delete',
                subject: 'User',
                conditions: condition
            }]
        });

        // Allowed
        expect(ability.can('delete', { __typename: 'User', role: 'user' })).toBe(true);

        // Forbidden by condition
        expect(ability.cannot('delete', { __typename: 'User', role: 'owner' })).toBe(true);
    });

    it('handles legacy owner logic via seeded permission', () => {
        // Owner now gets 'all:manage' via DB/prop, not hardcoded check
        const ability = defineAccessControlFor({
            permissions: [{ action: 'manage', subject: 'all' }]
        });
        expect(ability.can('manage', 'all')).toBe(true);
        expect(ability.can('delete', 'User')).toBe(true);
    });

    it('hydrates JSON string permissions', () => {
        const ability = defineAccessControlFor({
            permissions: [JSON.stringify({ action: 'read', subject: 'User' })]
        });
        expect(ability.can('read', 'User')).toBe(true);
    });

    it('handles malformed input safely', () => {
        const ability = defineAccessControlFor({
            permissions: [
                'invalid-string',
                '{bad json',
                '',
                // @ts-expect-error Testing invalid input
                undefined,
                // @ts-expect-error Testing invalid input
                null
            ]
        });
        // Should result in no grants, so everything is denied
        expect(ability.can('read', 'User')).toBe(false);
    });

    it('ignores malformed object permissions', () => {
        const ability = defineAccessControlFor({
            permissions: [
                { foo: 'bar' },
                { action: 'read' }, // Missing subject
                { subject: 'User' } // Missing action
            ]
        });
        expect(ability.can('read', 'User')).toBe(false);
    });

    it('denies all when no permissions provided', () => {
        const ability = defineAccessControlFor({});
        expect(ability.can('read', 'User')).toBe(false);
        expect(ability.cannot('read', 'User')).toBe(true);
    });
});
