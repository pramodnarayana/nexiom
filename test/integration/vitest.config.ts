import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    name: 'integration',
    include: ['**/*.integration.spec.ts'],
    globalSetup: [path.join(__dirname, 'setup/global-setup.ts')],
    setupFiles: [path.join(__dirname, 'setup/test-env-setup.ts')],
    testTimeout: 30000,
    hookTimeout: 30000,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
  },
});
