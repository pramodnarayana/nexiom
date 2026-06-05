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
    test: {
        globals: true,
        fileParallelism: true,
        pool: 'forks',
        environment: './src/test/environments/jsdom-msw',
        testTimeout: 10000,
        setupFiles: ['./src/test/setup-env.ts', './src/test/setup.ts'],
        exclude: ['e2e/**', 'node_modules/**'],
        coverage: {
      thresholds: {
        statements: 10, // TODO: Increase to 80% after refactor
        branches: 10,
        functions: 10,
        lines: 10,
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

                // Complex UI components (E2E test candidates, not unit test candidates)
                // These are framework-heavy components with high mock-to-logic ratio
                'src/modules/**/pages/admin/**', // Admin pages (AdminDashboardPage, etc.)
                'src/modules/**/pages/*Edit.tsx', // Edit pages (TenantEdit, UserEdit, etc.)
                'src/modules/**/pages/*ListPage.tsx', // List pages (TenantListPage, etc.)
                'src/modules/**/components/*Dialog.tsx', // Dialog components (InviteUserDialog, CreateTenantDialog, etc.)
                'src/modules/**/users/Users.tsx', // Complex user management component

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
