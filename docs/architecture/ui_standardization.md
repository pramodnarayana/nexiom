# UI Standardization Architecture (Shadcn + Tweakcn)

**Version:** 1.0 (Final)
**Status:** Approved
**Last Updated:** 2026-01-28

## 1. Executive Summary

We are standarizing the `apps/web` frontend on a modern, accessible, and enterprise-ready stack.

* **Base:** [Shadcn/UI](https://ui.shadcn.com/) for accessible, copy-paste components.
* **Theming:** [Tweakcn](https://tweak.shadcn.com/) for creating a distinct, premium "Enterprise" aesthetic.
* **Logic:** [Refine](https://refine.dev/) for strict CRUD operations and state management.
* **Security:** Deep integration with our new **PBAC** system via `accessControlProvider`.

---

## 2. Design System & Theming

### 2.1 The "Soopa Enterprise" Theme

We will move away from generic "Zinc/Slate" defaults to a curated palette.

* **Brand Color:** Deep Indigo/Violet (Trust, Stability).
* **Radius:** `0.5rem` (Modern, soft but professional).
* **Mode:** Dark Mode First logic (but fully supporting Light Mode).

**Implementation:**
We use CSS Variables in `globals.css` generated via Tweakcn. This allows us to change the entire feel of the app by updating a few HSL values without touching component code.

### 2.2 Component Strategy (Shadcn)

We do not install an NPM library. We own the code in `src/components/ui`.

* **Migration Rule:** "If a component exists in Shadcn, use it. Do not write custom CSS."
* **Customization:** Edit the primitive in `src/components/ui`, not the instance in the page.

### 2.3 Dynamic Theme Switching (Tweakcn)

Soopa supports runtime theme switching, but it is restricted to **Admins only**.

* **Component:** `ThemeSwitcher.tsx`
* **Security:** Wrapped in `<CanAccess resource="settings" action="manage">`.
* **Scope:** Admin changes set the **Tenant Default** theme (persisted to DB/LocalStorage).
* **User Experience:** Regular users see the theme chosen by the admin; they cannot override it.

---

## 3. Architecture & Patterns

### 3.1 Strict Refine Enforcement

To prevent "useEffect Hell", all Data Fetching for Admin/Dashboard routes MUST use Refine hooks.

**Anti-Pattern (Banned):**

```tsx
// ❌ Manual ID usage and fetching
useEffect(() => {
  fetch('/api/users').then...
}, [])
```

**Standard Pattern (Required):**

```tsx
// ✅ Refine handles state, caching, pagination, and invalidation
const { tableProps } = useTable({
  resource: "users",
  syncWithLocation: true
});
```

### 3.2 Secure UI Integration (PBAC)

The UI must reflect the new RBAC system. We do not just "hide" buttons; we "gate" them.

**1. The `useCan` Hook:**
Used for conditional rendering of major blocks (e.g. "Edit" buttons).

```tsx
const { data } = useCan({ resource: 'users', action: 'update' });
```

**2. The `<CanAccess>` Component:**
Used for declarative protection.

```tsx
<CanAccess resource="settings" action="manage" fallback={<LockedIcon />}>
  <SettingsForm />
</CanAccess>
```

**3. Menu Filtering:**
The Sidebar/Menu automatically filters items based on `list` (read) permission via `accessControlProvider`.

---

## 4. Implementation Priorities

### Phase 1: Foundation (The Setup)

1. **Init:** Initialize Shadcn in `apps/web` with proper path aliases.
2. **Theme:** Overwrite `globals.css` with the Tweakcn configuration.
3. **Layout:** Update `AdminLayout` and `DashboardLayout` to use the new atomic components (Sidebar, Navbar, Dropdowns).

### Phase 2: Core Components ( The Big Rocks)

Replace the most usage-heavy ad-hoc elements:

1. **Forms:** `Input`, `Select`, `Checkbox`, `Form` (React Hook Form + Zod).
2. **Data:** `Table` (TanStack), `Pagination`.
3. **Feedback:** `Toast` (Sonner), `Dialog` (Modal).

### Phase 3: Route Migration (Refactoring)

Iterate through `AdminRoutes`:

1. **Tenants List:** Convert to Shadcn Table + `useTable`.
2. **Users List:** Convert to Shadcn Table + `useTable`.
3. **Forms:** Convert to `useForm` + Shadcn Form Fields.

---

## 5. Verification Checklist

* [ ] **Visual:** Theme matches the design spec (Indigo/Dark).
* [ ] **Functional:** Forms validat correctly with Zod.
* [ ] **Security:** "Delete" buttons vanish when logged in as "Member".
* [ ] **Code:** No strict `fetch` calls in UI components.
