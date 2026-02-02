# Task 02d: Engineering Quality (Vitest & Coverage)

**Priority:** MEDIUM
**Status:** Pending
**Assignee:** Coder

## Objective

Unify the testing infrastructure across the monorepo by migrating `apps/api` to **Vitest** (aligning with `apps/web`) and enforcing a strict **90% code coverage** threshold.

## 1. Migration (apps/api)

- [ ] **Dependencies:**
  - Uninstall: `jest`, `ts-jest`, `@types/jest`, `supertest` (types only).
  - Install: `vitest`, `unplugin-swc`, `@vitest/coverage-v8`, `@swc/core`, `supertest` (keep for e2e).
- [ ] **Configuration:**
  - Create `apps/api/vitest.config.ts`.
  - Configure `swc` plugin to handle NestJS decorators (`emitDecoratorMetadata: true`).
  - Set alias mapping (same as `tsconfig.json`).

## 2. Test Refactoring

- [ ] **Update Specs:**
  - `jest.*` -> `vi.*`.
  - `beforeAll`, `afterAll` -> `beforeAll`, `afterAll` (Import from 'vitest').
  - Mocking: Update `jest.mock` to `vi.mock`.
- [ ] **E2E Tests:**
  - Ensure `supertest` works correctly with Vitest (may need manual `app.init()` handling).

## 3. Coverage Enforcement

- [ ] **Config:** Update `vitest.config.ts` with coverage settings.

    ```typescript
    coverage: {
      provider: 'v8',
      functions: 90,
      lines: 90,
      statements: 90,
    }
    ```

- [ ] **CI:** Update `.github/workflows/test.yml` (if exists) or local scripts to fail if coverage is unmet.

## Verification

- [ ] Run `pnpm test` in `apps/api`. All tests pass.
- [ ] Run `pnpm test:cov`. Coverage report generated.
- [ ] Verify build is not broken.
