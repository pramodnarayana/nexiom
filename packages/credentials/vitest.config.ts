import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.spec.ts'],
        coverage: {
      thresholds: {
        statements: 50, // TODO: Increase to 80% after refactor
        branches: 45,
        functions: 50,
        lines: 50,
      },
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['**/*.spec.ts', '**/*.test.ts', '**/constants/**', '**/*.d.ts'],
        },
    },
});
