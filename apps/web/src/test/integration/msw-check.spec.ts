import { describe, it, expect } from 'vitest';

describe('MSW Infrastructure', () => {
    it('should intercept raw fetch requests', async () => {
        const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';
        const url = `${baseUrl.replace(/\/+$/, '')}/auth/session`;
        const res = await fetch(url);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.user.email).toBe('test@example.com');
    });
});
