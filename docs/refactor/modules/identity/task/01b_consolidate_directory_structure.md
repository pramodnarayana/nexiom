# Task 01b: Consolidate Directory Structure

**Priority:** HIGH
**Estimated Time:** 2 hours
**Assignee:** Coder
**Status:** Ready to Start

---

## Objective

Refactor `apps/api` and `apps/web` to fully align with the goal structure by grouping Identity-related modules under a common `identity/` directory.

Currently, modules like `auth`, `users`, `tenants`, etc., sit at the root of `src/modules/`. This creates clutter and violates the bounded context principle.

---

## Implementation Steps

### 1. API Consolidation (`apps/api`)

- [ ] **Create Directory:** `apps/api/src/modules/identity/`
- [ ] **Move Modules:** Move the following existing modules into the new `identity` folder:
  - `auth` -> `src/modules/identity/auth`
  - `users` -> `src/modules/identity/users`
  - `tenants` -> `src/modules/identity/tenants`
  - `invitations` -> `src/modules/identity/invitations`
  - `system-admin` -> `src/modules/identity/system-admin` (Optional: Verify if this belongs strictly to identity or admin domain)
- [ ] **Refactor Imports:** Update all internal imports in `apps/api` to reflect the new paths.
- [ ] **Verify:** Ensure `app.module.ts` imports the modules from their new locations.

### 2. Frontend Consolidation (`apps/web`)

- [ ] **Create Directory:** `apps/web/src/modules/identity/`
- [ ] **Move Modules:** Move the following existing modules into the new `identity` folder:
  - `tenants` -> `src/modules/identity/tenants`
  - `users` -> `src/modules/identity/users`
  - `invitations` -> `src/modules/identity/invitations`
- [ ] **Consolidate Pages:**
  - Create `apps/web/src/pages/auth/`
  - Move `LoginPage.tsx`, `SignupPage.tsx` and related specs to `apps/web/src/pages/auth/`
- [ ] **Refactor Imports:** Update all component and page imports in `apps/web`.

---

## Acceptance Criteria

- [ ] `apps/api/src/modules/` is clean, containing properly grouped domains (`identity`, `billing`, etc. - billing might not exist yet).
- [ ] `apps/web/src/modules/` is clean, containing `identity/`.
- [ ] `apps/web/src/pages/auth/` contains the authentication pages.
- [ ] Application (`api` and `web`) builds and runs without import errors.
