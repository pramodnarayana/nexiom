import '@testing-library/jest-dom/vitest';
import 'whatwg-fetch';
import { vi } from 'vitest';

// Force polyfill to globalThis to ensure it's available for libraries wrapping fetch
// consistently before JSDOM or other tools interfere.
// Stub fetch globals so vi.unstubAllGlobals() can restore the whatwg-fetch polyfill
if (globalThis.fetch) {
    vi.stubGlobal('fetch', globalThis.fetch);
    vi.stubGlobal('Headers', globalThis.Headers);
    vi.stubGlobal('Request', globalThis.Request);
    vi.stubGlobal('Response', globalThis.Response);
}
