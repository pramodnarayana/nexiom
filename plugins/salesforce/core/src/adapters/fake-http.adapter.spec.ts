import { describe, it, expect } from 'vitest';
import { FakeHttpAdapter } from './fake-http.adapter.js';

describe('FakeHttpAdapter (Salesforce)', () => {
    it('should throw Not stubbed by default', async () => {
        const adapter = new FakeHttpAdapter();
        await expect(adapter.get('url', {})).rejects.toThrow('Not stubbed');
        await expect(adapter.post('url', {}, {})).rejects.toThrow('Not stubbed');
    });

    it('should allow custom stubs and record calls', async () => {
        const adapter = new FakeHttpAdapter();
        adapter.getStub = () => ({ status: 201, data: 'test', headers: {} });
        const res = await adapter.get('url1', { auth: '1' });
        expect(res.status).toBe(201);
        expect(res.data).toBe('test');
        expect(adapter.getCalls).toEqual([{ url: 'url1', headers: { auth: '1' } }]);

        adapter.postStub = () => ({ status: 202, data: 'test2', headers: {} });
        const res2 = await adapter.post('url2', { auth: '2' }, { b: 1 });
        expect(res2.status).toBe(202);
        expect(adapter.postCalls).toEqual([{ url: 'url2', headers: { auth: '2' }, body: { b: 1 } }]);
    });
});
