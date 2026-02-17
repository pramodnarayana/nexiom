import { describe, it, expect } from 'vitest';

describe('MSW Infrastructure', () => {
    it('should intercept raw fetch requests', async () => {
        const res = await fetch('http://localhost:3000/api/auth/session');
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.user.email).toBe('test@example.com');
    });
});
