import { builtinEnvironments } from 'vitest/environments';
import type { Environment } from 'vitest';

export default {
    name: 'jsdom-msw',
    transformMode: 'web',

    async setup(global, options) {
        // 1. Destructive Intervention: Remove Native Fetch
        // We do this BEFORE the JSDOM environment initializes to ensure
        // JSDOM doesn't inherit or try to use the Node.js fetch.
        const globalAny = global;
        if (globalAny.fetch) {
            delete globalAny.fetch;
            delete globalAny.Request;
            delete globalAny.Response;
            delete globalAny.Headers;
        }

        // 2. Initialize Standard JSDOM Environment
        // We use the built-in jsdom environment as the base.
        const jsdomEnv = builtinEnvironments.jsdom;
        const envTeardown = await jsdomEnv.setup(global, options);

        return {
            async teardown(global) {
                await envTeardown.teardown(global);
            }
        };
    }
} satisfies Environment;
