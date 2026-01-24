# Task: Implement Enterprise Security Layer

**Priority:** CRITICAL  
**Estimated Time:** 6-8 hours  
**Assignee:** Coder  
**Status:** Ready to Start

---

## Objective

Refactor the current codebase to align with the "Open Source Package Architecture" by introducing a `packages/` directory and extracting the core Identity logic. This is a PREREQUISITE to implementing the Enterprise Security Layer.

---

## Why This Matters

**Architecture:** Align with the vision of standalone open-source packages (@nexiom/identity)  
**Technical Debt:** Avoid building new security features on a coupled monolith structure  
**Maintainability:** Clear separation of concerns between API (HTTP) and Core Logic (Packages)  

---

## Implementation Steps (For Coder)

### Phase 1: Infrastructure & Interfaces

- [x] **Infrastructure:** Create `packages/identity` with `package.json` and `tsconfig.json`.
- [x] **Interfaces:** Implement `IAuthProvider`, `IUserProvider`, `ITenantProvider` in `packages/identity/src/interfaces`.

### Phase 2: Adapter Implementation

- [x] **Adapters:** Move existing logic from `apps/api` to `packages/identity/src/adapters/common-db`.
- [x] **Refactor:** Ensure adapters implement the interfaces defined in Phase 1.
- [x] **Cleanup:** Remove generic services from `apps/api`.

### Phase 3: Wiring

- [x] **Module:** Create `IdentityModule` in the package to export providers.
- [x] **Integration:** Update `apps/api` to consume the new package.

### Phase 4: Permission & RBAC Refactor

- [x] **Interface:** Define `IPermissionProvider` to abstract role checks.
- [x] **Implementation:** Replace hardcoded `platform_admin` string checks with capability-based checks (e.g., `can('create', 'tenant')`).
- [x] **Guards:** Create `PermissionGuard` to replace specific Role Guards where applicable.

### Phase 5: Remediation (Post-Review Checks)

- [ ] **Fix PlatformGuard:** Replace hardcoded `systemRole` checks with `IPermissionProvider.hasRole`.
- [ ] **Verify DrizzlePermissionAdapter:** Ensure the adapter is actually called during request interception.
- [ ] **Type Safety:** Improve typing in `BetterAuthAdapter` where `any` casting is used (if time permits).

---

## Acceptance Criteria

### Structure

- [x] `packages/identity` exists and contains Auth, User, Tenant logic
- [x] `apps/api` does NOT contain business logic for Auth/User/Tenant
- [x] `pnpm-workspace.yaml` is correctly configured

### Functionality

- [x] Application compiles without errors
- [x] Application starts successfully
- [x] User can Login/Signup (e2e verification)
- [x] Tenant management works as before

### Testing

- [x] Existing unit tests pass in their new location
- [x] Integration tests pass

---

**Status:** Completed  
**Next Task:** Task 02 - Enterprise Security Layer (Post-Refactor)
