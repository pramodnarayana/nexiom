# Engineering Quality Strategy (Vitest & Coverage)

**Version:** 1.0 (Final)
**Status:** Approved
**Last Updated:** 2026-01-28

## 1. Executive Summary

To ensure long-term maintainability and stability as we scale Nexiom, we are unifying our testing infrastructure.

* **Unified Runner:** **Vitest** for both Frontend (`apps/web`) and Backend (`apps/api`).
* **Performance:** leveraging `swc` for instant test execution.
* **Standards:** Strict **90% Code Coverage** enforcement.

This document serves as the implementation guide for migrating the API from Jest to Vitest.

---

## 2. Infrastructure Migration

### 2.1 Dependencies

We must remove the heavy Jest ecosystem and replace it with the lighter, faster Vitest stack.

**Remove (apps/api):**

* `jest`
* `ts-jest`
* `@types/jest`
* `supertest` (Types only; keep runtime for e2e)

**Install (apps/api):**

* `vitest` (The runner)
* `unplugin-swc` (Compiler for speed)
* `@vitest/coverage-v8` (Native coverage provider)
* `@swc/core` (Compiler core)

### 2.2 Configuration (`vitest.config.ts`)

The API requires specific handling for NestJS decorators.

```typescript
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    alias: {
      '@src': './src', // Match tsconfig.json
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Strict Enforcement (Targeting 90%, Enforcing 80%)
      functions: 80,
      lines: 80,
      statements: 80,
      branches: 70,
    },
  },
  plugins: [
    // Essential for NestJS DI to work correctly
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2021',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
```

---

## 3. Test Refactoring Guide

### 3.1 Syntax Changes

Migrating from Jest to Vitest requires minimal but widespread syntax updates.

| Feature | Jest | Vitest |
| :--- | :--- | :--- |
| **Global Mock** | `jest.mock(...)` | `vi.mock(...)` (Import `vi` from vitest) |
| **Spies** | `jest.spyOn(...)` | `vi.spyOn(...)` |
| **Time Travel** | `jest.useFakeTimers()` | `vi.useFakeTimers()` |
| **Lifecycle** | `beforeAll` (Global) | `beforeAll` (Import from vitest if not globals: true) |

### 3.2 E2E Testing with Supertest

NestJS + Vite requires ensuring the app is initialized correctly before `supertest` hits it.

```typescript
// Correct Pattern
const moduleFixture = await Test.createTestingModule({ ... }).compile();
app = moduleFixture.createNestApplication();
await app.init();
// Use app.getHttpServer() with supertest
```

---

## 4. Workflows

### 4.1 Local Development

* `pnpm test`: Fast unit tests (watch mode default).
* `pnpm test:cov`: Run tests with coverage report.

### 4.2 CI Pipeline

The pipeline must fail if:

1. tests fail.
2. coverage drops below 90%.

---

## 5. Verification Checklist

* [ ] **Clean:** No `jest` dependencies remain in `apps/api/package.json`.
* [ ] **Config:** `vitest.config.ts` is present and loads swc plugin.
* [ ] **Execution:** `pnpm test` runs mostly instantly (<1s startup).
* [ ] **Coverage:** `pnpm test:cov` reports >90% coverage on core modules.
