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

- [ ] **Infrastructure:** Create `packages/identity` with `package.json` and `tsconfig.json`.
- [ ] **Interfaces:** Implement `IAuthProvider`, `IUserProvider`, `ITenantProvider` in `packages/identity/src/interfaces`.

### Phase 2: Adapter Implementation

- [ ] **Adapters:** Move existing logic from `apps/api` to `packages/identity/src/adapters/common-db`.
- [ ] **Refactor:** Ensure adapters implement the interfaces defined in Phase 1.
- [ ] **Cleanup:** Remove generic services from `apps/api`.

### Phase 3: Wiring

- [ ] **Module:** Create `IdentityModule` in the package to export providers.
- [ ] **Integration:** Update `apps/api` to consume the new package.

---

## Acceptance Criteria

### Structure

- [ ] `packages/identity` exists and contains Auth, User, Tenant logic
- [ ] `apps/api` does NOT contain business logic for Auth/User/Tenant
- [ ] `pnpm-workspace.yaml` is correctly configured

### Functionality

- [ ] Application compiles without errors
- [ ] Application starts successfully
- [ ] User can Login/Signup (e2e verification)
- [ ] Tenant management works as before

### Testing

- [ ] Existing unit tests pass in their new location
- [ ] Integration tests pass

---

**Status:** Ready to Start  
**Next Task:** Task 02 - Enterprise Security Layer (Post-Refactor)
