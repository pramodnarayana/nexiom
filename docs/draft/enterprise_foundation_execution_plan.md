# Enterprise Foundation Execution Plan (v2)

**Objective:** Build a scalable, secure, enterprise-grade foundation.
**Approach:** "Fix the Foundation First" (Identity -> Security -> UI -> Testing).

---

## 📊 Status Audit: What is Done?

We have successfully established the **"Package Architecture"**.

* ✅ **Identity Kernel:** `packages/identity` is created and configured.
* ✅ **Contract Definition:** `IUserProvider`, `ITenantProvider`, `IAuthProvider` are defined.
* ✅ **Adapter Implementation:** `DrizzleUserAdapter` and `DrizzleTenantAdapter` are implemented.
* ✅ **Strict Layering:** `apps/api` controllers inject Interfaces (Providers), not the DB directly.
* ✅ **Basic Authorization:** `IPermissionProvider` exists with hardcoded logic.

---

## 🚀 Execution Path: What Needs to be Done?

### Phase 1: Advanced Security (DB-Backed RBAC)

**Goal:** Replace hardcoded permission logic with a database-driven Role-Based Access Control system.

#### 1.1 Schema Design (New Tables)

We will move away from simple string roles to a relational model.

* **`permissions`**: Granular capabilities.
  * `id` (text, pk)
  * `resource` (text) - e.g., 'users'
  * `action` (text) - e.g., 'create', 'read'
  * `description` (text)
* **`roles`**: Named sets of permissions.
  * `id` (text, pk)
  * `name` (text) - e.g., 'Tenant Admin', 'Viewer'
  * `description` (text)
  * `isSystem` (boolean) - Prevent deletion of core roles.
* **`role_permissions`**: The Join Table.
  * `roleId` (fk -> roles.id)
  * `permissionId` (fk -> permissions.id)
* **Refactor `member`**: Change `role` column to reference `roles.id` (FK).

#### 1.2 Implementation

* [ ] **Schema Migration:** Create Drizzle schema and migrations.

* [ ] **Seeding:** Create a seed script to populate standard permissions (`manage:users`, `view:audit_logs`) and default roles (`Owner`, `Admin`, `Member`).
* [ ] **Adapter Refactor:** Update `DrizzlePermissionAdapter.can()` to query these tables (with caching for performance).

---

### Phase 2: UI Standardization (Shadcn + Tweakcn)

**Goal:** Create a consistent, premium "Enterprise" look using Shadcn/UI and Tweakcn.

#### 2.1 Foundation

* [ ] **Install:** Initialize Shadcn/UI in `apps/web`.

* [ ] **Theme (Tweakcn):** Use **Tweakcn** to generate a unique, capability-focused color palette (Move away from default slate/zinc).
* [ ] **Typography:** Configure `Inter` or `Geist` font family.

#### 2.2 Component Migration

- [ ] **Refine Enforcement:** Ensure ALL Admin/Dashboard CRUD views use `@refinedev/core`.
  * *Audit:* Check `AdminRoutes` and `TenantRoutes` for manual fetch logic and replace with Refine hooks (`useList`, `useForm`).

* [ ] **Atomic Elements:** detailed migration of Buttons, Inputs, Dialogs, Sheets.
* [ ] **Data Display:** Implement `TanStack Table` (via Shadcn) for complex grids.
* [ ] **Forms:** Standardize on `react-hook-form` + `zod` + `shadcn/form`.

---

### Phase 3: Engineering Quality (Testing)

**Goal:** Unify the testing stack and enforce high quality standards.

#### 3.1 Migration

* [ ] **Vitest Adoption:** Migrate `apps/api` from Jest to **Vitest** (matching `apps/web`).
  * *Why?* Faster execution, native ESM support, unified config.

* [ ] **Config:** Setup `vitest.config.ts` with SWC for NestJS decorators.

#### 3.2 Coverage

* [ ] **Threshold:** Set CI failure threshold to **90%**.

* [ ] **E2E Strategy:** Ensure critical flows (Signup -> Login -> Create Tenant) are covered by E2E tests using `supertest`.

---

## 📅 Summary of Work Iterations

1. **Iteration 1: Security Core** (Schema changes, Permission seeding, Adapter logic).
2. **Iteration 2: Test Infrastructure** (Migrate API to Vitest, fix broken tests).
3. **Iteration 3: UI Foundation** (Shadcn init, Tweakcn theme, Layout refactor).
4. **Iteration 4: Component Rollout** (Systematic replacement of legacy UI).
