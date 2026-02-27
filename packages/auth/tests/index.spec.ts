import { describe, it, expect } from 'vitest';
import { RequestAuthContext } from '../src/index';

describe('Auth Package Smoke Test', () => {
    it('should compile and allow imports', () => {
        // Basic verification that the package structure is correct and vitest can see it
        const mockContext: RequestAuthContext = {
            headers: new Headers(),
            session: {} as any,
            user: {} as any,
        };
        expect(mockContext.headers).toBeDefined();
    });
});
