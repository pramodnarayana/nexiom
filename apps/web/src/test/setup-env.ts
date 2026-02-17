import '@testing-library/jest-dom/vitest';
import 'whatwg-fetch';
import { vi } from 'vitest';

// Force polyfill to globalThis to ensure it's available for libraries wrapping fetch
// consistently before JSDOM or other tools interfere.
Object.assign(globalThis, {
    fetch: globalThis.fetch,
    Headers: globalThis.Headers,
    Request: globalThis.Request,
    Response: globalThis.Response,
});

if (typeof globalThis !== 'undefined' && globalThis.fetch) {
    vi.stubGlobal('fetch', globalThis.fetch);
    vi.stubGlobal('Headers', globalThis.Headers);
    vi.stubGlobal('Request', globalThis.Request);
    vi.stubGlobal('Response', globalThis.Response);
}
