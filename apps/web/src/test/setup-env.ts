import '@testing-library/jest-dom/vitest';
// Required: jsdom-msw environment deletes native fetch globals before JSDOM
// initializes; whatwg-fetch re-polyfills Response/Headers/Request/fetch so MSW works.
import 'whatwg-fetch';
import { vi } from 'vitest';

// Stub fetch globals so vi.unstubAllGlobals() can restore them after each test suite
if (globalThis.fetch) {
    vi.stubGlobal('fetch', globalThis.fetch);
    vi.stubGlobal('Headers', globalThis.Headers);
    vi.stubGlobal('Request', globalThis.Request);
    vi.stubGlobal('Response', globalThis.Response);
}
