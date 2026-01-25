# Task 01d: Retire Legacy TenantsService

**Priority:** HIGH
**Estimated Time:** 2 hours
**Assignee:** Coder
**Status:** Ready to Start

---

## Objective

The `TenantsService` class in `apps/api/src/modules/identity/tenants/tenants.service.ts` is a legacy artifact that violates the Strict Layer Enforcement by injecting `DRIZZLE_DB` directly.

It duplicates logic (e.g., `provisionTenantForUser`) that is now correctly implemented in the `DrizzleTenantAdapter`.

**Goal:** Remove `TenantsService` entirely and refactor its consumers to use `ITenantProvider`.

---

## Implementation Steps

### 1. Refactor Consumers

- [ ] **Target:** `apps/api/src/modules/identity/tenants/tenants.controller.ts`
  - Inject `ITenantProvider` (token: `TENANT_PROVIDER`) instead of `TenantsService`.
  - Update methods to call provider methods directly.
- [ ] **Target:** `apps/api/src/modules/identity/auth/auth.service.ts`
  - Inject `ITenantProvider` instead of `TenantsService`.
  - Update `getEnrichedSession` to use `tenantProvider.findAllForUser`.

### 2. Verify Adapter Capabilities

- [ ] Ensure `DrizzleTenantAdapter` implements `provisionTenantForUser` correctly (it generates a slug and creates the org/member).
- [ ] Ensure `findAllForUser` is implemented.

### 3. Cleanup

- [ ] **Delete:** `apps/api/src/modules/identity/tenants/tenants.service.ts`
- [ ] **Delete:** `apps/api/src/modules/identity/tenants/tenants.service.spec.ts`
- [ ] **Remove Export:** Update `apps/api/src/modules/identity/tenants/tenants.module.ts` to stop exporting `TenantsService`.

---

## Verification Plan

- [ ] `grep -r "TenantsService" apps/api` should return 0 results (except maybe in migration files if any).
- [ ] `pnpm test apps/api` should pass.
- [ ] `grep -r "DRIZZLE_DB" apps/api/src/modules/identity` should return 0 results.
