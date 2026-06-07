import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'apps/*/vitest.config.{ts,mts,js}',
  'packages/*/vitest.config.{ts,mts,js}',
  'engine/application/*/vitest.config.{ts,mts,js}',
  'engine/platform/*/vitest.config.{ts,mts,js}',
  {
    test: {
      name: 'integration',
      include: ['test/integration/**/*.integration.spec.ts'],
      globalSetup: ['./test/integration/setup/global-setup.ts'],
      setupFiles: ['./test/integration/setup/test-env-setup.ts'],
      testTimeout: 30000,
      hookTimeout: 30000,
    }
  }
]);
