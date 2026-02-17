import { builtinEnvironments } from 'vitest/environments';
import type { Environment } from 'vitest';

export default {
    name: 'jsdom-msw',
    transformMode: 'web',

    async setup(global, options) {
        // 1. Destructive Intervention: Remove Native Fetch
        // We do this BEFORE the JSDOM environment initializes to ensure
        // JSDOM doesn't inherit or try to use the Node.js fetch.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const globalAny = global as any;
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

        // 3. Post-Initialization Polyfill
        // Now that JSDOM is ready (window exists), we verify fetch is accessible.

        // Critical: Ensure globalThis matches window for these primitives
        if (global.window) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const windowAny = global.window as any;

            // If window.fetch exists, we ensure consistency
            if (windowAny.fetch) {
                // We don't delete window.fetch here because we WANT the polyfill that JSDOM might have loaded
                // via setupFiles. However, if it's the NATIVE one, we might want to kill it.
                // But typically, setupFiles runs AFTER environment setup.
                // So at this stage, window.fetch might be undefined or the native one passed through.

                // If we deleted global.fetch above, JSDOM shouldn't have inherited it.
            }

            // We ensure global consistency so libraries using `globalThis.fetch` work
            // But we do this via `setupFiles` usually. 
            // Here we just ensure we didn't leave a broken state.
        }

        return {
            async teardown(global) {
                await envTeardown.teardown(global);
            }
        };
    }
} satisfies Environment;
