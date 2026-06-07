import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // Run in a single isolated fork — WebAssembly sandbox tests (e.g. memory-limit
    // tests) can spike host RSS briefly. Using a dedicated fork prevents these tests
    // from crashing shared Tinypool workers that other monorepo packages rely on.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
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
      exclude: ['**/*.spec.ts', '**/*.d.ts'],
    },
  },
});

