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
            exclude: ['src/**/*.spec.ts', 'src/**/index.ts'],
        },
    },
    plugins: [swc.vite({ module: { type: 'es6' } })],
});
