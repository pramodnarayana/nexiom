import { builtinEnvironments } from 'vitest/environments';
import type { Environment } from 'vitest/environments';

export default {
    name: 'jsdom-msw',
    viteEnvironment: 'client',

    async setup(
        global: Parameters<Environment['setup']>[0],
        options: Parameters<Environment['setup']>[1]
    ) {
        // The previous destructive intervention block that deleted fetch and Request 
        // was removed because Vitest 3+ requires globalThis.Request for its JSDOM compat logic.

        // 2. Initialize Standard JSDOM Environment
        // We use the built-in jsdom environment as the base.
        const jsdomEnv = builtinEnvironments.jsdom;
        const envTeardown = await jsdomEnv.setup(global, options);

        return {
            async teardown(global: Parameters<Environment['setup']>[0]) {
                await envTeardown.teardown(global);
            }
        };
    }
} satisfies Environment;
