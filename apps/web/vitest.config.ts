/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
                'src/shared/components/ui/**',
                'src/vite-env.d.ts',
                'src/types/**',
                'src/**/*.d.ts',
                '**/types.ts',
                '**/*.validation.ts',
            ],
            all: true,
        },
        env: {
            VITE_API_URL: 'http://localhost:3000/api',
        },
    },
});
