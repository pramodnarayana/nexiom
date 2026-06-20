import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['**/*.integration.spec.ts', '**/node_modules/**', '**/dist/**'],
    testTimeout: 30000,
    hookTimeout: 90000,
    // Run in a single isolated fork — WebAssembly sandbox tests (e.g. memory-limit
    // tests) can spike host RSS briefly. Using a dedicated fork prevents these tests
    // from crashing shared Tinypool workers that other monorepo packages rely on.
    pool: 'forks',
    fileParallelism: false,
    coverage: {
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        '**/*.d.ts',
        '**/*.interface.ts',
        '**/*.types.ts',
        'src/shared/adapters/**',
        'src/shared/fakes/**',
        'src/test-utils/**',
        // Infrastructure bootstrap files — no business logic
        'src/index.ts',
        'src/**/*.module.ts',
        'src/**/*.worker.ts',
        'src/shared/ports/**',
      ],
    },
  },
});

