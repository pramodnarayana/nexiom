import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        environment: 'happy-dom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        env: {
            VITE_API_URL: 'http://localhost:3000/api',
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: [
                'src/providers/auth-provider.ts',
                'src/lib/auth-client.ts',
                'src/pages/**/*.tsx',
                'src/components/**/*.tsx',
                'src/layouts/**/*.tsx'
            ],
            exclude: [
                'src/components/ui/**',
                'src/main.tsx',
                'src/App.tsx',
                'src/vite-env.d.ts',
                'src/pages/admin/**',
            ],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 80,
                statements: 80
            },
        },
    },
});
