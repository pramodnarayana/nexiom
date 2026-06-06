import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.spec.ts'],
        coverage: {
            thresholds: {
                statements: Number(process.env.COVERAGE_THRESHOLD) || 80,
                branches: Number(process.env.COVERAGE_THRESHOLD) || 80,
                functions: Number(process.env.COVERAGE_THRESHOLD) || 80,
                lines: Number(process.env.COVERAGE_THRESHOLD) || 80,
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
