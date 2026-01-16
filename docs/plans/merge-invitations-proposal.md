# Implementation Plan - Merge Invitations into User List

## Goal
Unified "Members" view that shows both Active Users and Pending Invitations in a single table.

## Proposed Changes

### Backend
#### [NEW] Endpoint `GET /invitations`
- **Controller**: `InvitationsController.list()`
- **Service**: `InvitationsService.list(organizationId)`
- **Logic**: Fetch all pending invitations for the current user's tenant.

### Frontend
#### [MODIFY] `apps/web/src/modules/users/UserList.tsx`
- **Data Fetching**:
  - Keep `useTable` for Users.
  - Add `useList` (Refine hook) for `invitations`.
- **Data Transformation**:
  - Map `invitations` to `UserTableItem` format:
    - `id`: `invitation.id`
    - `name`: `Pending Invitation` (or `null`)
    - `email`: `invitation.email`
    - `role`: `invitation.role`
    - `status`: `pending`
- **Rendering**:
  - Combine `users` and `invitations` arrays.
  - Sorting: Put Pending invites at the top (optional, but good UX).
  - Add Badge/Icon for "Pending" state in the Email or Status column.

#### [MODIFY] `apps/web/src/modules/users/types.ts`
- Update `UserTableItem` to include `status?: 'active' | 'pending' | 'disabled'`.

## Verification Plan
1.  **Manual**:
    - Open User List.
    - See "Active User" (Me).
    - See "Pending User" (invited email).
    - Add New Invite -> Watch it appear in list.
