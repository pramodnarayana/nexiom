import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.spec.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/*.spec.ts',
                'src/**/index.ts',
                'src/interfaces/**',
            ],
            thresholds: {
                statements: 80,
                branches: 78,
                functions: 80,
                lines: 80,
            },
        },
    },
    plugins: [
                // @ts-ignore - Type mismatch between vitest/config vite version and local vite plugin version
        swc.vite({ module: { type: 'es6' } })],
});
