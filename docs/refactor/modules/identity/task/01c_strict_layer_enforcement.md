# Task 01c: Strict Layer Enforcement

**Priority:** CRITICAL
**Estimated Time:** 4 hours
**Assignee:** Coder
**Status:** Ready to Start

---

## Objective

Fix the architectural violations in the Identity module. Specifically, `SystemAdminController` is bypassing the adapter layer and accessing the database directly, leading to brittle tests and vendor lock-in.

**Goal:** Ensure all Controllers interact ONLY with Interfaces (`IUserProvider`, `ITenantProvider`), never raw DB connections.

---

## Directives

> [!IMPORTANT]
> **Strict Rule:** No Controller in `apps/api` shall import `DRIZZLE_DB` or `NodePgDatabase`.

## Implementation Steps

### 1. Enhance Interfaces

- [ ] **Modify `IUserProvider`**: Add methods to support Admin Console requirements.
  - `findAll(options?: { page: number; limit: number; search?: string }): Promise<{ data: User[]; total: number }>`
  - `count(): Promise<number>`
- [ ] **Modify `ITenantProvider`**: Add methods for Admin listing.
  - `findAll(options?: { page: number; limit: number }): Promise<{ data: Tenant[]; total: number }>`

### 2. Implement Adapters

- [ ] **Update `DrizzleUserAdapter`**: Implement the new `findAll` and `count` methods using Drizzle.
- [ ] **Update `DrizzleTenantAdapter`**: Implement the new listing logic.

### 3. Refactor Controller

- [ ] **Target:** `apps/api/src/modules/identity/system-admin/system-admin.controller.ts`
- [ ] **Action:** Remove `@Inject(DRIZZLE_DB) private readonly db`.
- [ ] **Action:** Inject `@Inject(USER_PROVIDER) private readonly userProvider`.
- [ ] **Action:** Inject `@Inject(TENANT_PROVIDER) private readonly tenantProvider`.
- [ ] **Action:** Replace all `this.db.query...` calls with `this.userProvider...` or `this.tenantProvider...` calls.

### 4. Rewrite Tests

- [ ] **Target:** `apps/api/src/modules/identity/system-admin/system-admin.controller.spec.ts`
- [ ] **Action:** Remove all `MockDb` and Drizzle-chain mocking.
- [ ] **Action:** Mock the `IUserProvider` and `ITenantProvider` interfaces.
- [ ] **Verification:** Tests should look like: `expect(userProvider.findAll).toHaveBeenCalledWith(...)`.

---

## Verification Plan

- [ ] **Search:** Grep for `DRIZZLE_DB` in `apps/api/src/modules/identity/`. Result should be empty (except for Module definition).
- [ ] **Test:** Run `pnpm test apps/api`. Tests must pass without mocking Drizzle internals.
