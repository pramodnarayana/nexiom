@# Task 02c: Advanced Security (DB-Backed RBAC)

**Priority:** CRITICAL
**Status:** Ready to Start
**Assignee:** Coder

## Objective

Replace the current hardcoded/string-based permission system with a robust, database-driven Role-Based Access Control (RBAC) system. This enables dynamic role creation and granular permission management.

## 1. Schema Design (Drizzle)

**File:** `packages/identity/src/schema.ts`

Add the following tables. Ensure strict foreign key relationships.

### `permissions`

- `id`: text (PK)
- `resource`: text (not null) - e.g., 'users', 'tenants'
- `action`: text (not null) - e.g., 'create', 'read', 'update', 'delete'
- `description`: text
- `createdAt`: timestamp

### `roles`

- `id`: text (PK)
- `name`: text (not null, unique within tenant if we want tenant-specific roles, but for now system-wide roles + tenant association is cleaner. Let's stick to **Tenant-scoped roles** if possible, but standard roles are easier. *Decision: Global Roles for this iteration to keep it simple, or Tenant-specific?* -> **Global Roles** are standard (Owner, Admin, Member).
- `description`: text
- `isSystem`: boolean (default false) - Prevents deletion of core roles (Owner, Admin, Member).

### `role_permissions` (Join Table)

- `roleId`: references `roles.id`
- `permissionId`: references `permissions.id`
- PK: (roleId, permissionId)

### Updates to `member` table

- **Modify:** `role` column.
  - *Current:* text (enum-like string).
  - *New:* text (Foreign Key to `roles.id`).

## 2. Seed Script

**File:** `packages/identity/src/scripts/seed-rbac.ts` (Create new)

Create a script to populate the DB with these specific INITIAL values.
**Note:** Use a `permissions` array of objects `{ action, resource, description }` to iterate and upsert.

### Initial Permissions (The "Starter Pack")

| Resource | Action | Description |
| :--- | :--- | :--- |
| `users` | `create` | Invite or create new users |
| `users` | `read` | View user lists and profiles |
| `users` | `update` | Edit user details |
| `users` | `delete` | Remove users from the tenant |
| `roles` | `manage` | Create/Edit/Delete custom roles |
| `roles` | `read` | View available roles |
| `billing` | `manage` | specific credit cards, change plans |
| `billing` | `read` | View invoices and usage |
| `settings` | `manage` | Update tenant settings (name, domain) |
| `api_keys` | `manage` | Create and revoke API keys |

### Initial Roles (Standard Presets)

1. **Owner**
    - **Description:** "Full access to all resources and settings."
    - **Permissions:** `*` (Wildcard logic handled in Adapter) OR assign ALL permission IDs.

2. **Admin**
    - **Description:** "Can manage users, roles, and settings, but cannot delete the workspace."
    - **Permissions:**
        - `users.*` (create, read, update, delete)
        - `roles.*` (manage, read)
        - `settings.manage`
        - `billing.read`
        - `api_keys.manage`

3. **Member**
    - **Description:** "Standard access. Can view data but cannot manage users or billing."
    - **Permissions:**
        - `users.read`
        - `roles.read`

## 3. The Unified Policy Mechanism (PBAC style)

To satisfy the requirement for a consistent "Check Function", we will standardise on the **Capability** pattern:

**Backend (The Source of Truth):**
`IPermissionProvider.can(user: User, action: string, resource: string): Promise<boolean>`

**Frontend (Refine Integration):**
`accessControlProvider.can({ resource, action }): Promise<CanResponse>`

**Rules:**

1. **NEVER** check `user.roles.includes('admin')` in UI components or Controllers.
2. **ALWAYS** ask "Can this user [Action] this [Resource]?".
3. The *Adapter* is responsible for resolving the User -> Roles -> Permissions graph.

## 4. Adapter Refactor

**File:** `packages/identity/src/adapters/drizzle-permission.adapter.ts`

Refactor the `can` method to implement this resolution logic:

```typescript
async can(user, action, resource, tenantId): Promise<boolean> {
  // 1. Fetch ALL permissions for the user (from their roles in this tenant)
  // 2. Check if (action, resource) exists in that set.
  // 3. Handle wildcards (e.g. if user has 'users:*', then 'users:create' is true).
  // 4. Return boolean.
}
```

## Verification

- [ ] Run `db:generate` and `db:migrate`.
- [ ] Run seed script.
- [ ] Verify `DrizzlePermissionAdapter.can` returns correct results for different roles.
