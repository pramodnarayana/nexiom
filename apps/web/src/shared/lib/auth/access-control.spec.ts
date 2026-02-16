import { defineAccessControlFor } from './access-control';
import { describe, it, expect } from 'vitest';
import { Resources } from './constants';

describe('AccessControlFactory', () => {
    it('hydrates simple permissions', () => {
        const ability = defineAccessControlFor({
            permissions: [`${Resources.USERS}:read`]
        });
        expect(ability.can('read', Resources.USERS)).toBe(true);
        expect(ability.cannot('delete', Resources.USERS)).toBe(true);
    });

    it('hydrates JSON rules with conditions', () => {
        const condition = { role: { $ne: 'owner' } };
        const ability = defineAccessControlFor({
            permissions: [{
                action: 'delete',
                subject: Resources.USERS,
                conditions: condition
            }]
        });

        // Allowed
        expect(ability.can('delete', { __typename: Resources.USERS, role: 'user' })).toBe(true);

        // Forbidden by condition
        expect(ability.cannot('delete', { __typename: Resources.USERS, role: 'owner' })).toBe(true);
    });

    it('handles legacy owner logic via seeded permission', () => {
        // Owner now gets 'all:manage' via DB/prop, not hardcoded check
        const ability = defineAccessControlFor({
            permissions: [{ action: 'manage', subject: 'all' }]
        });
        expect(ability.can('manage', 'all')).toBe(true);
        expect(ability.can('delete', Resources.USERS)).toBe(true);
    });

    it('hydrates JSON string permissions', () => {
        const ability = defineAccessControlFor({
            permissions: [JSON.stringify({ action: 'read', subject: Resources.USERS })]
        });
        expect(ability.can('read', Resources.USERS)).toBe(true);
    });

    it('hydrates JSON string permissions with conditions', () => {
        const rule = {
            action: 'delete',
            subject: Resources.USERS,
            conditions: { role: { $ne: 'owner' } }
        };
        const ability = defineAccessControlFor({
            permissions: [JSON.stringify(rule)]
        });

        expect(ability.can('delete', { __typename: Resources.USERS, role: 'user' })).toBe(true);
        expect(ability.cannot('delete', { __typename: Resources.USERS, role: 'owner' })).toBe(true);
    });

    it('handles malformed input safely', () => {
        const ability = defineAccessControlFor({
            permissions: [
                'invalid-string',
                '{bad json',
                '',
                undefined as unknown as string,
                null as unknown as object,
                ''
            ]
        });
        // Should result in no grants, so everything is denied
        expect(ability.can('read', Resources.USERS)).toBe(false);
    });

    it('ignores malformed object permissions', () => {
        const ability = defineAccessControlFor({
            permissions: [
                { foo: 'bar' },
                { action: 'read' }, // Missing subject
                { subject: Resources.USERS } // Missing action
            ]
        });
        expect(ability.can('read', Resources.USERS)).toBe(false);
    });

    it('denies all when no permissions provided', () => {
        const ability = defineAccessControlFor({});
        expect(ability.can('read', Resources.USERS)).toBe(false);
        expect(ability.cannot('read', Resources.USERS)).toBe(true);
    });
});
