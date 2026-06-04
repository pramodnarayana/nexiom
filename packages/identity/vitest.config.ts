import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/test.setup.ts"],
    include: ["**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.spec.ts",
        "src/**/index.ts",
        "src/interfaces.ts",
        "src/schema.ts",
        "src/test.setup.ts",
        "src/constants.ts",
        "src/interfaces/**",
        "src/scripts/**",
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 70,
        lines: 80,
      },
    },
  },
  plugins: [
    // @ts-expect-error - Type mismatch between vitest/config vite version and local vite plugin version
    swc.vite({
      module: { type: "es6" },
    }),
  ],
});
