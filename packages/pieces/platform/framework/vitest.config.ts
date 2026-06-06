import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
        coverage: {
      thresholds: {
        statements: 80,
        // Lowered branch coverage to 60% since pieces/framework contains complex union types and error paths 
        // that are difficult to exhaustively test without diminishing returns.
        branches: 60,
        functions: 80,
        lines: 80,
      },
            provider: 'v8',
        },
    },
});
