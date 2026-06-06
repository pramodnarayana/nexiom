import { describe, it, expect } from 'vitest';
import { evaluateConditions, Condition } from './evaluator.js';

describe('evaluateConditions', () => {
    it('returns true if no conditions', () => {
        expect(evaluateConditions([], { a: 1 })).toBe(true);
    });

    it('evaluates eq properly', () => {
        expect(evaluateConditions([{ field: 'a', op: 'eq', value: '1' }], { a: '1' })).toBe(true);
        expect(evaluateConditions([{ field: 'a', op: 'eq', value: '1' }], { a: '2' })).toBe(false);
    });

    it('coerces numbers', () => {
        expect(evaluateConditions([{ field: 'a', op: 'eq', value: '1' }], { a: 1 })).toBe(true);
        expect(evaluateConditions([{ field: 'a', op: 'gt', value: '1' }], { a: 2 })).toBe(true);
    });

    it('coerces booleans', () => {
        expect(evaluateConditions([{ field: 'a', op: 'eq', value: 'true' }], { a: true })).toBe(true);
        expect(evaluateConditions([{ field: 'a', op: 'eq', value: 'false' }], { a: false })).toBe(true);
    });

    it('evaluates neq', () => {
        expect(evaluateConditions([{ field: 'a', op: 'neq', value: '1' }], { a: '2' })).toBe(true);
    });

    it('evaluates contains', () => {
        expect(evaluateConditions([{ field: 'a', op: 'contains', value: '1' }], { a: '123' })).toBe(true);
        expect(evaluateConditions([{ field: 'a', op: 'contains', value: '1' }], { a: ['1', '2'] })).toBe(true);
        expect(evaluateConditions([{ field: 'a', op: 'contains', value: '1' }], { a: 123 })).toBe(false);
    });

    it('handles nested paths', () => {
        expect(evaluateConditions([{ field: 'a.b', op: 'eq', value: '1' }], { a: { b: '1' } })).toBe(true);
    });

    it('evaluates AND logic within a group', () => {
        const conditions: Condition[] = [
            { field: 'a', op: 'eq', value: '1' },
            { field: 'b', op: 'eq', value: '2' }
        ];
        expect(evaluateConditions(conditions, { a: '1', b: '2' })).toBe(true);
        expect(evaluateConditions(conditions, { a: '1', b: '3' })).toBe(false);
    });

    it('evaluates OR logic across groups', () => {
        const conditions: Condition[] = [
            { field: 'a', op: 'eq', value: '1' },
            { field: 'b', op: 'eq', value: '2', logic: 'OR' }
        ];
        expect(evaluateConditions(conditions, { a: '1', b: '3' })).toBe(true);
        expect(evaluateConditions(conditions, { a: '2', b: '2' })).toBe(true);
        expect(evaluateConditions(conditions, { a: '2', b: '3' })).toBe(false);
    });

    it('handles unknown ops securely', () => {
        expect(evaluateConditions([{ field: 'a', op: 'unknown', value: '1' }], { a: '1' })).toBe(false);
    });

    it('guards against prototype pollution', () => {
        expect(evaluateConditions([{ field: '__proto__.polluted', op: 'eq', value: '1' }], {})).toBe(false);
        expect(evaluateConditions([{ field: 'constructor.prototype.polluted', op: 'eq', value: '1' }], {})).toBe(false);
    });

    it('evaluates lt', () => {
        expect(evaluateConditions([{ field: 'a', op: 'lt', value: '2' }], { a: 1 })).toBe(true);
        expect(evaluateConditions([{ field: 'a', op: 'lt', value: '2' }], { a: 3 })).toBe(false);
    });

    it('guards against non-object access', () => {
        expect(evaluateConditions([{ field: 'a.b.c', op: 'eq', value: '1' }], { a: 1 })).toBe(false);
    });
});
