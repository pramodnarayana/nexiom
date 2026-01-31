/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/setupTests.ts',
        coverage: {
            enabled: true,
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/**/*.spec.{ts,tsx}',
                'src/**/*.test.{ts,tsx}',
                'src/setupTests.ts',
                'src/**/index.ts',
                'src/shared/components/ui/*.tsx',
                'src/vite-env.d.ts'
            ],
            all: true,
        },
    },
});
