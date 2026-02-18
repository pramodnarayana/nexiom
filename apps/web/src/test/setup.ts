import { beforeAll, afterEach, afterAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

import { server } from './mocks/server';
import axios from 'axios';

// Force Axios to use the fetch adapter to align with JSDOM/MSW environment
// and avoid XHR/http issues. modern axios supports 'fetch' string or adapter import.
// If this fails, we might need to upgrade axios or use a different strategy.
axios.defaults.adapter = 'fetch';

// -----------------------------------------------------------------------------
// MSW LIFECYCLE
// -----------------------------------------------------------------------------
// Start server before all tests
beforeAll(() => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:3000/api');
    vi.stubEnv('DEV', true);
    vi.stubEnv('MODE', 'test');
    vi.stubEnv('SSR', false);
    server.listen({ onUnhandledRequest: 'warn' });
});

// Close server after all tests
afterAll(() => {
    vi.unstubAllGlobals();
    server.close();
});

// Reset handlers after each test
afterEach(() => {
    cleanup();
    server.resetHandlers();
});
