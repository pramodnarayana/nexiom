# Core Database Schema (v7.0 - Identity & Workspace Isolation)

This document defines the structure for the Control Plane (Shared Identity/Auth) and the Data Plane (Isolated Workspace Silos).

## 1. Public Schema (Control Plane)

**Scope:** Global Platform Registry
**Managed by:** Better-Auth & Core Identity Services

### A. Identity & Authentication

These tables handle users, their external OAuth accounts, and session security.

| Table Name | Purpose | Key Columns |
| :--- | :--- | :--- |
| `user` | Primary identity. | `id`, `email`, `name`, `email_verified`, `organization_id` (FK) |
| `session` | Active login sessions. | `id`, `user_id`, `expires_at`, `active_workspace_id` |
| `account` | OAuth provider links. | `id`, `user_id`, `provider_id`, `account_id`, `access_token` |
| `verification` | Email/OTP tokens. | `id`, `identifier`, `value`, `expires_at` |

### B. Organizations, Workspaces & Connectivity

The "Map" of the platform. **Rule:** A user belongs to exactly one Organization.

| Table Name | Purpose | Key Columns |
| :--- | :--- | :--- |
| `organization` | Legal/Billing entity. | `id`, `name`, `slug`, `billing_tier` |
| `workspace` | The Schema Pointer. | `id`, `org_id`, `name`, `slug`, `db_schema_name` |
| `member` | Links User to Org. | `id`, `organization_id`, `user_id`, `role_id` |
| `invitation` | Pending team invites. | `id`, `organization_id`, `email`, `status` |
| `app_connection` | Credential Store. | `id`, `workspace_id`, `app_name`, `encrypted_credentials`, `status` |

### C. Access Control (RBAC/CBAC)

| Table Name | Purpose | Key Columns |
| :--- | :--- | :--- |
| `role` | Named role sets. | `id`, `name`, `description` |
| `permission` | Atomic capabilities. | `id`, `action`, `resource` |
| `role_permission` | Policy mapping. | `role_id`, `permission_id` |

## 2. Workspace Schema (Data Plane / Silo)

**Scope:** Isolated per Workspace (e.g., schema `ws_envoy_prod` / `ws_envoy_sandbox`)

### A. The Gateway Buffers (Layer 1 & 4)

These tables act as the "Waiting Rooms" for data entering and leaving the platform.

| Table Name | Purpose | Key Columns |
| :--- | :--- | :--- |
| `inbound_gateway` | L1 Ingestion. Raw webhooks. | `id`, `source_app`, `payload` (JSONB), `status`, `received_at` |
| `outbound_gateway` | L4/5 Outbound. API requests. | `id`, `target_app`, `connection_id` (FK), `payload` (JSONB), `status` |

### B. Integration Configuration

| Table Name | Purpose | Key Columns |
| :--- | :--- | :--- |
| `integration_stitch` | Defines a flow. | `id`, `name`, `source_app_id`, `dest_app_id`, `status` |
| `field_mapping` | JSON templates. | `id`, `stitch_id`, `source_canonical`, `mapping_template` (JSONB) |

### C. The Sync Engine Core (Dynamic JSONB)

| Table Name | Purpose | Key Columns |
| :--- | :--- | :--- |
| `replica_entity` | Raw data store (L2). | `id`, `source_id`, `entity_type`, `data` (JSONB), `updated_at` |
| `normalized_entity` | Canonical data (L3). | `id`, `canonical_type`, `data` (JSONB), `status` |
| `global_entity_map` | ID cross-reference. | `source_id`, `source_app`, `dest_id`, `dest_app`, `last_synced` |

### D. Observability

| Table Name | Purpose | Key Columns |
| :--- | :--- | :--- |
| `sync_log` | Trace history. | `id`, `stitch_id`, `layer`, `status`, `error_payload` |
| `notification_log` | Failed sync alerts. | `id`, `error_code`, `message`, `status` |

## 3. Implementation Notes

- **Why `app_connection` is Public:** Moving this to the Public schema allows the global API Gateway to handle OAuth callbacks and token refreshes without needing to guess which workspace schema to open first. It is secured by `workspace_id` and `organization_id` foreign keys.
- **The Gateway Pattern:**
  - `inbound_gateway` ensures we never lose a webhook from a source app even if our workers are down.
  - `outbound_gateway` allows us to audit the exact JSON payload being sent to an external API before it is transmitted.
- **Physical Isolation:** Business data (Invoices, Customers, Webhook Payloads) remains strictly inside the Workspace Schema. Only identity, routing metadata, and encrypted credentials live in the Public Schema.
