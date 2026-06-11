import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    exclude: [
      '**/*.integration.spec.ts',
      '**/node_modules/**',
      '**/dist/**',
    ],
    globalSetup: [path.join(__dirname, 'test/integration/setup/global-setup.ts')],
    setupFiles: [path.join(__dirname, 'test/integration/setup/test-env-setup.ts')],
  },
});
