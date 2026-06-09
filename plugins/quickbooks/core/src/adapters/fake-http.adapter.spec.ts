import { describe, it, expect } from 'vitest';
import { FakeHttpAdapter } from './fake-http.adapter.js';

describe('FakeHttpAdapter (QuickBooks)', () => {
    it('should use default stubs', async () => {
        const adapter = new FakeHttpAdapter();
        const getRes = await adapter.get('url', {});
        expect(getRes.status).toBe(200);
        expect(getRes.data).toEqual({});

        const postRes = await adapter.post('url', {}, {});
        expect(postRes.status).toBe(200);
        expect(postRes.data).toEqual({});
    });

    it('should allow custom stubs', async () => {
        const adapter = new FakeHttpAdapter();
        adapter.getStub = () => ({ status: 201, data: 'test' });
        const res = await adapter.get('url', {});
        expect(res.status).toBe(201);
        expect(res.data).toBe('test');
    });
});
