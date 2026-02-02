# Task 02b: UI Standardization (Shadcn + Tweakcn)

**Priority:** HIGH
**Status:** Pending (After RBAC)
**Assignee:** Coder

## Objective

Standardize the frontend (`apps/web`) on a modern, accessible component stack using **Shadcn/UI** as the base, **Tweakcn** for enterprise theming, and **Refine** for strict CRUD logic.

## 1. Foundation Setup

- [ ] **Initialize Shadcn:**
  - Run `npx shadcn@latest init` in `apps/web`.
  - Options: Default style, Slate color (will be overridden), CSS variables: Yes.
- [ ] **Install Tweakcn Theme:**
  - Use Tweakcn to generate a "Nexiom Enterprise" theme (Deep Blue/Indigo primary, distinct radius).
  - Copy the generated CSS variables into `apps/web/src/globals.css`.

## 2. Refine Enforcement (CRUD Views)

**Audit:** `apps/web/src/routes/{AdminRoutes.tsx, TenantRoutes.tsx}`

- [ ] **Identify Compliance:**
  - Ensure all routes under `/admin/*` and `/dashboard/*` that display lists or forms are using Refine hooks (`useList`, `useForm`, `useTable`).
- [ ] **Refactor:**
  - If a component uses `useEffect` + `fetch`/`axios` manually for data, replace it with `useList` (for tables) or `useOne` (for details).
  - Ensure `<Refine>` provider is correctly wrapping these routes.

## 3. Component Migration

Install and implement the following Shadcn components to replace current ad-hoc implementations:

- [ ] **Core:** `radix-ui` based Button, Input, Select, Checkbox.
- [ ] **Feedback:** `sonner` (Toast).
- [ ] **Overlays:** `Dialog` (Modal), `Sheet` (Drawer).
- [ ] **Data:** `TanStack Table` (via `shadcn/ui/table` and `data-table`).

## Verification

- [ ] Start `apps/web`.
- [ ] Verify the new Theme is applied (colors, fonts).
- [ ] Verify Admin User List uses `useTable` (Refine) and Shadcn Table UI.
