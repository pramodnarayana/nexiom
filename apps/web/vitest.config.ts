import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    plugins: [
        // @ts-expect-error - Type mismatch between vitest/config vite version and local vite plugin version
        react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    test: { name: 'web',
        globals: true,
        fileParallelism: true,
        environment: 'jsdom',
        testTimeout: 10000,
        setupFiles: [
            path.resolve(__dirname, './src/test/setup-env.ts'),
            path.resolve(__dirname, './src/test/setup.ts')
        ],
        exclude: ['e2e/**', 'node_modules/**'],
        coverage: {
            thresholds: {
                statements: 70,
                branches: 50, // Avoid over-mocking React lifecycle & UI conditionals (e.g., window.confirm)
                functions: 70,
                lines: 70,
            },
            enabled: true,
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                // Test files
                'src/**/*.spec.{ts,tsx}',
                'src/**/*.test.{ts,tsx}',
                'src/setupTests.ts',

                // Test infrastructure
                'src/test/**',

                // Build artifacts and type definitions
                'src/**/index.ts',
                'src/vite-env.d.ts',
                'src/types/**',
                'src/**/*.d.ts',
                '**/types.ts',
                '**/*.validation.ts',

                // UI library components (not business logic)
                'src/shared/components/ui/**',

                // Entry points (integration layer, not unit testable)
                'src/main.tsx',
                'src/App.tsx',

                // Presentational UI components (E2E test candidates)
                // Enterprise Headless Hook Pattern: Business logic is tested in hooks (.ts files),
                // while dumb view components (.tsx files in modules) are excluded from unit test coverage metrics
                // in favor of Playwright/Cypress E2E tests.
                'src/modules/**/*.tsx',
                'src/shared/components/**',

                // Third-party UI library hooks
                'src/shared/hooks/use-toast.ts',

                // Route components (integration layer)
                'src/app/routes/**',

                // Layout components (presentational)
                'src/app/layouts/**',
            ],
        },
        env: {
            VITE_API_URL: 'http://localhost:3000/api',
        },
    },
});
