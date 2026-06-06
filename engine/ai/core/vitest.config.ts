import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.spec.ts'],
        coverage: {
            thresholds: {
                statements: 0,
                branches: 0,
                functions: 0,
                lines: 0,
            },
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.spec.ts', 'src/**/index.ts'],
        },
    },
    plugins: [
        swc.vite({ module: { type: 'es6' } }) as any,
    ],
});
