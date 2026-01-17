import '@testing-library/jest-dom';


// Cleanup
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

vi.stubEnv('VITE_API_URL', 'http://localhost:3000/api');
vi.stubEnv('DEV', true);
vi.stubEnv('MODE', 'test');
vi.stubEnv('SSR', false);

afterEach(() => {
    cleanup();
});
