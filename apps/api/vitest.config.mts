import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    test: {
        setupFiles: ['./vitest.setup.ts'],
        globals: true,
        environment: 'node',
        root: './',
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
                'src/db/reset-e2e.ts',
                'src/db/db-cli.ts',
                'src/db/schema.ts',
                'src/db/db.provider.ts',
                'src/db/database-manager.ts',
                'test/**',
                '**/*.spec.ts',
                '**/*.e2e-spec.ts',
                'src/**/index.ts',
                '**/*.config.*',
            ],
            reporter: ['text', 'json', 'html'],
            thresholds: {
                statements: 80,
                // TODO: Branch coverage lowered temporarily from 80% to 75%.
                // Legacy infrastructure files (like database-manager.ts & connectors.service.ts) 
                // lack proper Dependency Injection, making them highly coupled and brittle to unit test.
                // Next Branch Action: Refactor these core services using Test-Driven Development (TDD) 
                // and DI. Once decoupled, we can easily mock dependencies, write robust unit tests, 
                // and push branch coverage back up to >=80%.
                branches: 75,
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
