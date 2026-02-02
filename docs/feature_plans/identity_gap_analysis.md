# Identity Module: Feature Gap Analysis & Implementation Plan

**Status:** Draft
**Date:** 2026-01-29

## 1. Current State (Implemented)

The current `packages/identity` provides a solid "B2B SaaS" foundation:

* **Authentication:**
  * Session-based Auth (Bearer Token/Cookie).
  * Social Login Support (`account` table).
  * Impersonation (`impersonatedBy` field).
* **Multi-Tenancy:**
  * Organization (Tenant) Schema.
  * Membership (User <-> Org <-> Role).
  * Invitation System (Email-based).
* **Authorization (PBAC):**
  * Dynamic Roles & Permissions (`role`, `permission`, `role_permission`).
  * Unified `can(user, action, resource)` checking.
* **User Management:**
  * Basic Profile.
  * System Roles (`platform_admin` vs `platform_user`).
  * Ban Management.

## 2. Missing Features (The "Enterprise" Gap)

To meet "Enterprise" standards (and the Architect's vision), we are missing the following.
**Label Guide:**

* **[BUY]**: Use existing Better-Auth plugin or built-in feature (Low Effort).
* **[BUILD]**: Build custom solution from scratch (Medium/High Effort).

### 2.1 Critical Security (Must Have)

1. **MFA (Multi-Factor Authentication)** `[BUY]`
    * **Strategy:** Use `twoFactor` plugin.
    * **Gap:** No schema support for TOTP secrets or backup codes.
    * **Requirement:** Enable 2FA per user. Enforce 2FA per Tenant (Security Policy).
2. **Password Recovery** `[BUY]`
    * **Strategy:** Use built-in `emailAndPassword` recovery hooks.
    * **Gap:** Flow needs verification. `verification` table exists, but need specific "Forgot Password" logic.
    * **Requirement:** Secure reset flow with expiration.
3. **Audit Logs** `[BUILD]`
    * **Strategy:** Custom `audit_log` table + Interceptors.
    * **Gap:** No audit logging in schema.
    * **Requirement:** Immutable log of *who* did *what* *when* (e.g., "User X invited User Y"). Business-critical for SOC2.

### 2.2 Advanced Connectivity (Should Have)

4. **Enterprise SSO (SAML/OIDC)** `[BUY]`
    * **Strategy:** Use `sso` plugin (OIDC/SAML).
    * **Gap:** `account` table handles OAuth, but Enterprise SSO needs Tenant-specific config.
    * **Requirement:** "Bring Your Own IDP" (Okta, Azure AD) for Organizations.
2. **API Keys (Personal Access Tokens)** `[BUILD]`
    * **Strategy:** Custom `api_key` table linked to RBAC.
    * **Gap:** Better-Auth `apiKey` is for machine-to-machine; we need user-scoped tokens.
    * **Requirement:** Allow developers to access API via keys (scoped to User or Org).

### 2.3 User Experience (Nice to Have)

6. **Session Management UI** `[BUILD]`
    * **Strategy:** Custom UI consuming Better-Auth `listSessions` API.
    * **Gap:** API exists, Front-end UI missing.
    * **Requirement:** UI to list sessions (IP, Geo, Device) and revoke them.
2. **Rate Limiting / Brute Force** `[BUILD]`
    * **Strategy:** Custom Middleware (Redis/Memory).
    * **Gap:** Middleware enforcement.
    * **Requirement:** Redis-backed rate limiting on Auth endpoints.

---

## 3. Implementation Plan

We will tackle these in **3 Phases**.

### Phase 1: Security Hardening (Priority)

**Goal:** Secure the login flow and provide visibility.

1. **Audit Logs (Task 03a) [BUILD]:** (Prioritization adjusted in task.md)
    * **Schema:** Create `audit_log` table (User ID, Org ID, Action, Resource, Metadata, IP).
    * **Service:** `AuditService.log(event)`.
    * **Integration:** Emit events on Login, Invite, Role Change.
2. **Password Reset Flow (Task 03b) [BUY]:**
    * **Schema:** Reuse `verification` table (type: 'password-reset').
    * **API:** `POST /api/auth/forget-password`, `POST /api/auth/reset-password`.
    * **Email:** Send standard template.
3. **Email Verification (Task 03c) [BUY]:**
    * **Enforcement:** Block login (or nag) if `emailVerified = false` (Built-in config).

### Phase 2: MFA & Sessions

**Goal:** Advanced user protection.

1. **MFA (TOTP) [BUY]:**
    * **Schema:** Add `twoFactor` fields via Plugin migration.
    * **Flow:** QR Code generation -> Verify -> Enforce on Login.
2. **Session Management [BUILD]:**
    * **API:** `GET /auth/sessions`, `DELETE /auth/sessions/:id`.
    * **UI:** "Security" tab in User Settings.

### Phase 3: Enterprise Connectivity

**Goal:** "Enterprise" tier features.

1. **API Keys [BUILD]:**
    * **Schema:** `api_key` table (hashed token, scope, expiration, last_used).
    * **Guard:** `ApiKeyGuard`.
2. **Enterprise SSO (SAML) [BUY]:**
    * **Schema:** `sso_config` table (Org ID, IDP Metadata, Attribute Mapping).
    * **Lib:** Integrate `node-saml` or similar.
