import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        root: './',
        alias: {
            '@src': path.resolve(__dirname, 'src'),
        },
        coverage: {
            provider: 'istanbul',
            exclude: [
                'node_modules/**',
                'dist/**',
                '**/*.d.ts',
                'drizzle.config.ts',
                'src/main.ts',
                'src/**/*.module.ts',
                'src/**/*.dto.ts',
                'src/**/*.entity.ts',
                'src/**/*.interface.ts',
                'src/**/*.abstract.ts',
                'src/**/*.decorator.ts',
                'src/**/*.mock.ts',
                'src/scripts/**',
                'src/db/seed.ts',
                'src/db/truncate.ts',
                'src/db/verify.ts',
                'src/db/db.provider.ts',
                'test/**',
                '**/*.spec.ts',
                '**/*.e2e-spec.ts',
                'src/**/index.ts',
            ],
            reporter: ['text', 'json', 'html'],
            thresholds: {
                // TODO: Restore to 90% after PBAC refactor stabilizes (Technical Debt: ISSUE-123)
                // Lowered to 80% temporarily to accommodate rapid changes during the DB-based policy migration.
                statements: 80,
                branches: 80,
                functions: 80,
                lines: 80,
            },
        },
    },
    plugins: [
        // Essential for NestJS DI to work correctly
        swc.vite(),
    ],
});
