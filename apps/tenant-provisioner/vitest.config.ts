import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    typecheck: {
      tsconfig: './tsconfig.spec.json',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'src/main.ts',
        'src/**/*.module.ts',
        'src/**/*.event.ts',
        'src/**/*.dto.ts',
        'src/**/*.interface.ts',
        '**/*.spec.ts',
        'vitest.config.ts',
        'node_modules/**',
        'dist/**'
      ],
    },
  },
  plugins: [
        // This is required to build the test files with SWC
            // @ts-ignore - Type mismatch between vitest/config vite version and local vite plugin version
        swc.vite({
      // Explicitly set the module type to avoid conflicts with nestjs/cli
      module: { type: 'es6' },
    }),
  ],
});
