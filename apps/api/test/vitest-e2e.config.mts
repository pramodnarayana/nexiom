import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    include: ['**/*.e2e-spec.ts'],
    globals: true,
    root: './',
    alias: {
      '@src': path.resolve(__dirname, '../src'),
    },
  },
  // @ts-ignore - Type mismatch between vitest/config vite version and local vite plugin version
  plugins: [swc.vite()],
});
