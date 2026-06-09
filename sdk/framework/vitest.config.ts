import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
        coverage: {
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
            provider: 'v8',
        },
    },
});
