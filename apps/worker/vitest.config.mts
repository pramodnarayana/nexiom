import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    root: path.resolve(__dirname),
    test: {
        setupFiles: ['./vitest.setup.ts'],
        globals: true,
        environment: 'node',
        alias: {
            '@src': path.resolve(__dirname, 'src'),
        },
        server: {
            deps: {
                external: ['@nexiom/auth', '@nexiom/identity'],
            },
        },
        env: {
            SYSTEM_TENANT_ID: '00000000-0000-0000-0000-000000000000',
            OWNER_ROLE_ID: 'owner',
            ADMIN_ROLE_ID: 'admin',
            MEMBER_ROLE_ID: 'member',
        },
        coverage: {
            provider: 'v8',
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
                'src/modules/ai/**',
                'src/constants.ts',
                'src/db/**',
                'test/**',
                '**/*.spec.ts',
                '**/*.e2e-spec.ts',
                'src/**/index.ts',
                '**/*.config.*',
                'scratch_*.cjs',
                'scratch_*.ts',
                '*.cjs',
            ],
            reporter: ['text', 'json', 'html'],
            thresholds: {
                statements: 75,
                branches: 65,
                functions: 75,
                lines: 75,
            },
        },
    },
    plugins: [
        // Essential for NestJS DI to work correctly
        // @ts-expect-error - Type mismatch between vitest/config vite version and local vite plugin version
        swc.vite({
            module: { type: 'es6' },
            jsc: {
                parser: {
                    syntax: 'typescript',
                    decorators: true,
                    tsx: false,
                },
                transform: {
                    legacyDecorator: true,
                    decoratorMetadata: true,
                },
            },
        }),
    ],
});
