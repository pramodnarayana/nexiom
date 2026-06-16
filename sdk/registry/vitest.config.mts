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
        server: {
            deps: {
                external: [],
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
                'src/**/*.module.ts',
                'src/pieces/piece-execution.worker.ts',
                'test/**',
                '**/*.spec.ts',
                '**/*.e2e-spec.ts',
                'src/**/index.ts',
                '**/*.config.*',
            ],
            reporter: ['text', 'json', 'html'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
        },
    },
    plugins: [
        // Essential for NestJS DI to work correctly
                // @ts-ignore - Type mismatch between vitest/config vite version and local vite plugin version
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
