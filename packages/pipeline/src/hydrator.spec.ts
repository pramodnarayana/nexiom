import { describe, it, expect } from 'vitest';
import { hydratePayload, Rule } from './hydrator.js';

describe('hydratePayload', () => {
    it('returns empty object if no rules and no data', () => {
        expect(hydratePayload()).toEqual({});
    });

    it('returns data if no rules', () => {
        expect(hydratePayload([], { a: 1 })).toEqual({ a: 1 });
    });

    it('hydrates basic payload', () => {
        const rules: Rule[] = [
            { src: 'a', dest: 'b' }
        ];
        expect(hydratePayload(rules, { a: 1 })).toEqual({ b: 1 });
    });

    it('hydrates nested payload', () => {
        const rules: Rule[] = [
            { src: 'a.b', dest: 'c.d' }
        ];
        expect(hydratePayload(rules, { a: { b: 1 } })).toEqual({ c: { d: 1 } });
    });

    it('ignores unsafe source paths', () => {
        const rules: Rule[] = [
            { src: '__proto__.a', dest: 'b' }
        ];
        expect(hydratePayload(rules, { a: 1 })).toEqual({ a: 1 });
    });

    it('throws on unsafe dest paths', () => {
        const rules: Rule[] = [
            { src: 'a', dest: '__proto__.b' }
        ];
        expect(() => hydratePayload(rules, { a: 1 })).toThrow('unsafe path segment "__proto__"');
    });

    it('throws if intermediate key is not object', () => {
        const rules: Rule[] = [
            { src: 'a', dest: 'b' },
            { src: 'c', dest: 'b.d' }
        ];
        expect(() => hydratePayload(rules, { a: 1, c: 2 })).toThrow('intermediate key "b" in path "b.d" already holds a non-object value');
    });

    it('throws if required field is missing', () => {
        const rules: Rule[] = [
            { src: 'a', dest: 'b', required: true }
        ];
        expect(() => hydratePayload(rules, {})).toThrow("Mapping validation failed: Required mapped field 'b' resolved to empty/null from source path 'a'.");
    });

    it('handles root payload properly', () => {
        const rules: Rule[] = [
            { src: '$.a', dest: '$.b' }
        ];
        expect(hydratePayload(rules, { a: 1 })).toEqual({ b: 1 });
    });

    it('returns unmapped data when markUnmapped is true and no fields were mapped', () => {
        expect(hydratePayload([], { a: 1 }, true)).toEqual({ _unmapped: true, a: 1 });
    });
});
