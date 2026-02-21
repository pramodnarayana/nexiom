# Implementation Plan: End-to-End Connector Architecture

This document synthesizes the architectural plan for a complete, end-to-end integration engine capable of scaling to 500+ apps. It covers the full lifecycle from the user discovering an app in the UI to the continuous background refresh of connection tokens.

## Primary Objective

Provide a seamless "Marketplace" experience for users to connect third-party apps, while establishing a secure, dynamic, and generic integration engine in the backend that handles authentication and continuous token validity.

---

## Complete Project Directory Structure

To support 500+ scalable integrations, the codebase spans multiple workspaces inside the monorepo:

```text
nexiom/
├── apps/
│   ├── api/
│   │   └── src/
│   │       └── modules/engine/connections/  # API Gateway: OAuth Handshakes & Marketplace endpoints
│   └── web/
│       └── src/
│           ├── app/layouts/TenantLayout.tsx # Navigation: Sidebar layout rendering
│           └── modules/integrations/        # Frontend: App Directory, Search, Connect Flow UI
├── integrations/                            # Isolated Vendor Connectors (Activepieces model)
│   ├── salesforce/                          # Explicit implementation of a single vendor API
│   ├── quickbooks/
│   └── ...                                  # Scalability path for 500+ vendors
└── packages/
    ├── database/
    │   └── src/schema/tenant.ts             # Database: `app_connection` standard schema
    └── engine/
        └── src/
            ├── connectivity/                # Core: TokenManagerService & ProviderRegistryService
            └── crypto/                      # Crypto: EncryptionService for secure tokens
```

---

## Enterprise-Grade "Pieces" Architecture (Activepieces/n8n Inspired)

To ensure this system is truly enterprise-grade and scalable to 500+ integrations without creating a monolithic bottleneck, this architecture borrows heavily from the "Pieces/Nodes" concepts popularized by **Activepieces** and **n8n**:

1. **Headless, Schema-Driven UI:**
   The frontend Marketplace contains **zero** hardcoded integration logic. Instead, when a user clicks an integration, the frontend reads the `ConnectorAuthSchema` JSON payload from the backend. The backend dictates whether to render a generic OAuth redirect button, or dynamically spawn input fields for API Keys and Custom Subdomains.

2. **Decoupled Execution Nodes (`integrations/` folder):**
   Just like Activepieces, each integration lives in its own isolated package/folder. The core `@nexiom/engine` has no hardcoded knowledge of "Salesforce" or "HubSpot". The registry dynamically loads these "pieces" via database metadata.

3. **Background Token Resilience:**
   Similar to enterprise systems, the API Gateway does not perform token refreshes on the fly during user requests. Instead, a robust Redis-backed concurrency lock (`TokenManagerService`) silently refreshes OAuth tokens in the background before any data sync worker executes, ensuring 100% token validity without race conditions.

---

## 0. Backend Foundation (Completed)

Before starting on the Marketplace, the core foundation of the engine has been established:

* `@nexiom/engine` workspace package created.
* `EncryptionService` configured for secure credential storage.
* `TokenManagerService` created with Redis concurrent locks for smart token refresh.
* `app_connection` standard table established in the database schema.
* Base `IntegrationProvider` interface and `ProviderRegistryService` implemented.

## 1. Frontend: The Integrations Marketplace

*(Target Path: `apps/web/src/modules/integrations/`)*

* **Sidebar Navigation:** Add a "Marketplace" or "Integrations" link to the main navigation sidebar (`apps/web/src/app/layouts/TenantLayout.tsx`).
* **App Directory UI:** Build a page displaying available integrations as a grid of cards (e.g., Salesforce, QuickBooks, HubSpot).
* **Search & Filter:** Implement a search bar and category filters (e.g., CRM, Accounting) to easily find specific apps.
* **Connect Flow:**
  * Each app card will have a "Connect" button.
  * Clicking "Connect" initiates an OAuth handshake or opens a dynamic credential form (based on the `ConnectorAuthSchema` provided by the backend) for API key inputs.
  * For OAuth, the button links to `GET /api/connect/:provider?tenantId={currentTenantId}`.

## 2. API Gateway: Unified OAuth Handshake

*(Target Path: `apps/api/src/modules/engine/connections/`)*

To automatically configure third-parties using **Grant.js**, the backend must support generic callback interception and secure credential storage.

* **Dynamic Grant.js Middleware Layer**
  * A custom middleware or NestJS module is built to inject Grant.js into the Express application lifecycle.
  * This custom middleware queries the `ProviderRegistryService` (database `providers` table) on boot to dynamically construct the Grant configuration object containing all vendor `authorizeUrl`, `tokenUrl`, and `scopes`.
  * It maps the kickoff route specifically to `GET /api/connect/:provider`.

* **The Connection Flow:**
    1. User clicks "Connect" -> Redirects to `GET /api/connect/:provider?tenantId={currentTenantId}`.
    2. The dynamically mounted Grant.js middleware intercepts this route. It securely stores `tenantId` in the `state` parameter and redirects the browser to the third-party's OAuth login screen (e.g., Salesforce login).
    3. User authenticates -> Third-party redirects back to `/api/connect/:provider/callback`.
    4. The `OAuthCallbackController` intercepts the callback, extracting the `grant.response` tokens and original `state` payload (Tenant ID context).
    5. Tokens are deeply encrypted via AES-256-GCM (`AesEncryptionService`).
    6. Encrypted credentials and metadata are saved to the `app_connection` table using Upsert.
    7. User is redirected back to the Marketplace UI with a success state `?success=true`.

## 3. Database Layer: `app_connection` Standard Schema

Ensure the Tenant Schema uses a unified `app_connection` table.

* **Fields:** `appName`, `authType` (OAUTH2, API_KEY), `encryptedCredentials` (KMS/AES-256), `expiresAt`, `status` (ACTIVE, EXPIRED, REVOKED), and `metadata`.
* **Action:** Define this schema within `@nexiom/database/src/schema` explicitly.

## 4. Integration Core Layer: `@nexiom/engine`

A dedicated workspace package to isolate credential loading and syncing behaviors from the control plane API.

* **Action:** Define an `IntegrationProvider` base class and a `ProviderRegistry` that maps dynamic JSON credentials metadata for the frontend to render dynamically (e.g., `shopifyAuthSchema`).

## 5. Continuous Token Refresh Engine

The system must guarantee that stored tokens are always valid for background workers (sync engines) to use without interruption.

* **Objective:** Implement a resilient, continuous token management system.
* **Mechanism (The `TokenManagerService`):**
  * When a background worker needs to make an API call, it requests credentials via `getValidCredentials(connectionId)`.
  * **Check:** The Token Manager checks `expiresAt`. If `expiresAt` < NOW (with a 5-minute buffer), it triggers a refresh.
  * **Concurrency Lock:** It uses Redis `SET` with `NX` and `PX` (e.g., `SET lock_key connection_id NX PX 30000`) to acquire a lock for that specific connection ID with a TTL. This ensures locks auto-expire if a holder crashes. It stores a unique lock value (like the owner ID) to safely verify ownership before releasing it, preventing accidental unlocks.
  * **Refresh:** Only the worker holding the lock makes the HTTP call to the vendor's Token URL to get new tokens.
  * **Wait:** Other concurrent requests for the same connection sleep and retry.
  * **Save:** The new access and refresh tokens are encrypted and saved back to the `app_connection` table, updating `expiresAt`.
  * **Result:** The worker is guaranteed a valid, unexpired token payload to execute the integration logic.

---

## Verification Plan

### Automated Tests

1. **Token Manager Mocking:** Create Vitest unit tests for `TokenManagerService` focusing on the Redis lock `SET` with `NX` and `PX` mechanism to ensure only *one* promise triggers an outgoing OAuth refresh API call, while subsequent calls wait and receive the updated token.
2. **Database Insertion Flow:** Build tests mapping a mocked `grant.js` response payload through the `OAuthCallbackController` to ensure it invokes `EncryptionService` and populates `app_connection` accurately. Ensure test runner configuration uses `vitest.config.ts` and Vitest import usage.

### Manual End-to-End Verification

1. Login to the web dashboard.
2. Navigate to "Marketplace" via the sidebar.
3. Search for a test integration (e.g., a dummy OAuth provider).
4. Click "Connect" and complete the OAuth flow.
5. Verify successful redirect back to the app and confirm the connection shows as "Active".
6. Query the database to ensure credentials are saved in the `app_connection` table and are correctly encrypted.
7. Simulate a token expiration in the database and run a test script that fetches credentials to verify the background refresh mechanism acquires a lock, updates the token, and saves the new expiry.
