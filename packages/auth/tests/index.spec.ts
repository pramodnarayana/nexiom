import { describe, it, expect } from 'vitest';
import { RequestAuthContext } from '../src/index';

describe('Auth Package Smoke Test', () => {
    it('should compile and allow imports', () => {
        // Basic verification that the package structure is correct and vitest can see it
        const mockContext: Partial<RequestAuthContext> = {
            headers: new Headers(),
            session: { id: 'test-session', userId: 'test-user', token: 'mock-token', createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(), ipAddress: null, userAgent: null, impersonatedBy: null },
            user: { id: 'test-user', email: 'test@example.com', name: 'Test User', image: null, emailVerified: true, role: 'user', banned: false, banReason: null, banExpires: null, createdAt: new Date(), updatedAt: new Date() },
        };
        expect(mockContext.headers).toBeDefined();
    });
});
