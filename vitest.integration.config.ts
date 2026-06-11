import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    include: ['test/integration/**/*.integration.spec.ts', 'packages/**/*.integration.spec.ts'],
    globalSetup: ['./test/integration/setup/global-setup.ts'],
    setupFiles: ['./test/integration/setup/test-env-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  }
});
