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
│   │       └── modules/connections/  # API Gateway: OAuth Handshakes & Marketplace endpoints
│   └── web/
│       └── src/
│           ├── app/layouts/TenantLayout.tsx              # Navigation: Sidebar layout rendering
│           └── modules/integrations/                    # Frontend: App Directory, Search, Connect Flow UI
│               └── components/ConnectAppCard.tsx        # Popup OAuth trigger component
├── integrations/                            # Isolated Vendor Connectors (Activepieces model)
│   ├── salesforce/                          # Explicit implementation of a single vendor API
│   ├── quickbooks/
│   └── ...                                  # Scalability path for 500+ vendors
└── packages/
    ├── database/
    │   └── src/schema/tenant.ts             # Database: `app_connection` standard schema
    └── connections/                         # (alias: @nexiom/connections)
        └── src/
            ├── connectivity/                # Core: TokenManagerService & ProviderRegistryService
            ├── http/                        # NexiomHttpClient (Goal 2)
            ├── piece-framework/             # Shim types for Activepieces compatibility (Goal 2)
            └── crypto/                      # Crypto: EncryptionService for secure tokens
```

---

## Enterprise-Grade "Pieces" Architecture (Activepieces/n8n Inspired)

To ensure this system is truly enterprise-grade and scalable to 500+ integrations without creating a monolithic bottleneck, this architecture borrows heavily from the "Pieces/Nodes" concepts popularized by **Activepieces** and **n8n**:

1. **Headless, Schema-Driven UI:**
   The frontend Marketplace contains **zero** hardcoded integration logic. Instead, when a user clicks an integration, the frontend reads the `ConnectorAuthSchema` JSON payload from the backend. The backend dictates whether to render a generic OAuth redirect button, or dynamically spawn input fields for API Keys and Custom Subdomains.

2. **Decoupled Execution Nodes (`integrations/` folder):**
   Just like Activepieces, each integration lives in its own isolated package/folder. The core `@nexiom/connections` has no hardcoded knowledge of "Salesforce" or "HubSpot". The registry dynamically loads these "pieces" via database metadata.

3. **Background Token Resilience:**
   Similar to enterprise systems, the API Gateway does not perform token refreshes on the fly during user requests. Instead, a robust Redis-backed concurrency lock (`TokenManagerService`) silently refreshes OAuth tokens in the background before any data sync worker executes, ensuring 100% token validity without race conditions.

---

## 0. Backend Foundation (Completed)

Before starting on the Marketplace, the core foundation of the engine has been established:

* `@nexiom/connections` workspace package created.
* `EncryptionService` configured for secure credential storage.
* `TokenManagerService` created with Redis concurrent locks for smart token refresh.
* `app_connection` standard table established in the database schema.
* Base `IntegrationProvider` interface and `ProviderRegistryService` implemented.

## 1. Frontend: The Integrations Marketplace

*(Target Path: `apps/web/src/modules/integrations/`)*

* **Sidebar Navigation:** Add a "Marketplace" or "Integrations" link to the main navigation sidebar (`apps/web/src/app/layouts/TenantLayout.tsx`).
* **App Directory UI:** Build a page displaying available integrations as a grid of cards (e.g., Salesforce, QuickBooks, HubSpot).
* **Search & Filter:** Implement a search bar and category filters (e.g., CRM, Accounting) to easily find specific apps.
* **Connect Flow (Popup-Based OAuth):** See [Popup OAuth Strategy](#popup-oauth-strategy) below.

### Popup OAuth Strategy

To preserve the user's current context when connecting a third-party app, Nexiom implements a **popup-based OAuth flow** rather than redirecting the entire browser window.

**Why a Popup?**

A hard redirect to the vendor's login screen destroys the user's current context (e.g., an in-progress workflow configuration). By executing the OAuth flow inside a dedicated popup (`window.open`):

1. **Context Preservation:** The main application window remains untouched.
2. **Session Stitching is Unnecessary:** No server-side `redirectTo` cookies or state restoration needed.
3. **Cleaner UX:** The popup naturally focuses the user on the auth task and closes on completion.

**The Authorized Handshake Flow (End-to-End):**

1. **Initiation (Main Window)**
   * User clicks the "Connect" button on an app card.
   * The React app constructs the backend URL (e.g., `https://api.nexiom.com/connect/salesforce`).
   * React calls `window.open(url, '_blank', 'resizable=no,width=600,height=800')`.
   * The main window sets up `window.addEventListener('message', handler)` to wait for the result.

2. **Backend Kickoff (Popup Window)**
   * The popup hits `ConnectorsController` (`GET /connect/:provider`).
   * The backend generates the vendor's required scopes and authorization URL via `ProviderRegistryService`.
   * A secure stateless JWT is generated containing `tenantId` as the OAuth `state` parameter.
   * The popup is redirected to the vendor's login page.

3. **Vendor Authentication (Popup Window)**
   * The user logs in and grants permissions in the vendor's UI.
   * The vendor redirects the popup back to `https://api.nexiom.com/connect/:provider/callback`.

4. **Token Exchange & Storage (Popup Window)**
   * `OAuthCallbackController` intercepts the callback.
   * It extracts `code` and verifies the JWT `state` to confirm `tenantId` and integrity.
   * The backend exchanges the `code` for `access_token` and `refresh_token`.
   * Credentials are encrypted and stored in the `app_connection` table.

5. **Completion & Hand-off (Popup → Main Window)**
   * Instead of a redirect, the callback returns a **self-closing HTML page** that:
     1. Calls `window.opener.postMessage({ status: 'success', provider: 'salesforce' }, '*')` to notify the main window.
     2. Calls `window.close()` to destroy the popup.
   * The main React window receives the `message` event, shows a success toast, and refreshes the connections list — without ever reloading.

**Error Handling:** If the callback results in an error, the popup page calls `window.opener.postMessage({ status: 'error', error: 'auth_failed' }, '*')` before closing.

---

## 2. API Gateway: Stateless OAuth Handshake

*(Target Path: `apps/api/src/modules/connections/`)*

The backend uses a **stateless JWT-based state parameter** instead of server-side session storage (e.g., Grant.js middleware). This makes the OAuth flow horizontally scalable.

* **The Connection Flow (Implemented — Goal 1 ✅):**
    1. User clicks "Connect" → popup opens and hits `GET /api/connect/:provider`.
    2. `ConnectorsController` reads the provider's `authorizeUrl`, `scopes`, and `tokenUrl` from `ProviderRegistryService`.
    3. A signed JWT (via `OauthStateService`) is generated with `tenantId`, `provider`, and optional `realmId` as the OAuth `state`.
    4. The popup is redirected to the vendor's login screen.
    5. User authenticates → vendor redirects to `/api/connect/:provider/callback`.
    6. `OAuthCallbackController` verifies the JWT `state`, extracts `tenantId` and `realmId`.
    7. `ConnectorsService` exchanges the `code` for tokens via the vendor's `tokenUrl`.
    8. Tokens are encrypted via `EncryptionService` and stored in `app_connection` (upsert).
    9. A self-closing HTML page is returned to the popup which fires `postMessage` back to the main window.

## 3. Database Layer: `app_connection` Standard Schema

Ensure the Tenant Schema uses a unified `app_connection` table.

* **Fields:** `appName`, `authType` (OAUTH2, API_KEY), `encryptedCredentials` (KMS/AES-256), `expiresAt`, `status` (ACTIVE, EXPIRED, REVOKED), and `metadata`.
* **Action:** Define this schema within `@nexiom/database/src/schema` explicitly.

## 4. Integration Core Layer: `@nexiom/connections`

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

## 6. Integration Execution Engine (Goal 2: Reading & Writing Data)

Once Goal 1 OAuth connections are established, the system needs a secure, scalable way to execute business logic (read, write, update) against vendor APIs. To support 500+ apps without writing custom HTTP handlers for every endpoint, Nexiom implements a **Decoupled Execution Framework** inspired by Activepieces.

### A. The `Piece` Concept

Every integration in the `integrations/` folder is defined as a `Piece`. A `Piece` exposes two main things:

1. **Auth metadata:** Which we use in Goal 1 to get the token.
2. **Actions:** Modular functions like `createContact` or `updateInvoice`.

### B. Action Definition Schema

To standardize how we talk to 500+ APIs, every Action is defined by a strict TypeScript schema. An Action contains:

* `name`: e.g., `'create_contact'`
* `displayName`: e.g., `'Create Contact'`
* `props`: A declarative list of inputs required from the user/workflow (e.g., `email` (string), `firstName` (string)).
* `run(context)`: The async TypeScript function that executes the vendor API call. It constructs the request, sends it via the injected `HttpClient`, awaits the response, and either returns a standardized result object (e.g., `Promise<ActionResult>`) or throws a typed error on failure. The `run` function never handles authentication directly — it delegates to `HttpClient` for credential injection.

### C. The Activepieces Compatibility Layer

To leverage thousands of open-source Activepieces actions **without rewriting or maintaining custom fetch logic**, Nexiom implements a shim inside `@nexiom/connections`.

> **Key Insight:** We do **not** need to run the entire Activepieces Node.js engine — we only need their TypeScript type signatures.

**The Shim Architecture:**

Nexiom exports `createPiece`, `createAction`, `PieceAuth`, and `Property` with the **exact same TypeScript signatures** as `@activepieces/pieces-framework`. This means open-source Activepieces integration files can be dropped into `nexiom/integrations/` and work immediately.

**Folder structure** (mirrors Activepieces):

* Every app is isolated in its own directory (e.g., `integrations/salesforce/`)
* `index.ts` exports a `createPiece({ ... })` wrapper (defining `PieceAuth.OAuth2`, scopes, actions)
* Actions like `create-contact.ts` use `createAction({ props: {...}, run(context) {...} })`

### D. The Nexiom `HttpClient` Wrapper

The single most powerful override is replacing Activepieces' `httpClient.sendRequest()`. When a copied action calls `await httpClient.sendRequest()`, our `NexiomHttpClient` intercepts it and:

1. Calls `TokenManagerService.getValidCredentials(connectionId)` to get a guaranteed unexpired token.
2. Switches on `Piece.authType` to choose the correct injection strategy:
   * **Bearer / OAuth 2.0:** Injects `Authorization: Bearer <accessToken>` header.
   * **API Key:** Appends key to URL query string or designated header per provider convention.
   * **Basic Auth:** Encodes `username:password` in Base64 and sets `Authorization: Basic <encoded>`.
3. Normalizes credential shape so `run(context)` always receives a consistent interface regardless of `authType`.
4. Executes the vendor API call with credentials already applied.

> **Note:** `@nexiom/connections` is a workspace alias that maps to `packages/connections`. `NexiomHttpClient` lives at `packages/connections/src/http/nexiom-http-client.ts`.

### E. Why this is Enterprise-Grade

1. **Code Portability:** We can copy-paste `salesforce/actions/create-contact.ts` from the Activepieces GitHub repository into `integrations/salesforce/` and it will instantly work with `TokenManagerService`.
   > **Compliance Note:** Activepieces code is MIT-licensed. When copying `Piece` or `Action` files into `integrations/`, developers MUST preserve the original MIT license header and attribute Activepieces. Before merging, verify attribution against the **project-level compliance checklist** at [`docs/compliance/CHECKLIST.md`](../compliance/CHECKLIST.md). Nexiom's `TokenManagerService` and `HttpClient` execute these actions natively, but strict adherence to upstream licensing at the file level is required.
2. **Sandboxed Credentials:** The `run(context)` function **never sees the raw, decrypted OAuth tokens** — only the `HttpClient` does.
3. **Instant Scalability:** Access to hundreds of CRM, Marketing, and Accounting workflows without writing bespoke HTTP wrappers.
4. **Sandboxing:** Actions are stateless functions. They can eventually run in isolated Node.js child processes or AWS Lambda for untrusted code.

---

## Verification Plan

### Automated Tests

1. **Token Manager Mocking:** Vitest unit tests for `TokenManagerService` focusing on the Redis `SET NX PX` lock mechanism — ensuring only one promise triggers an outgoing refresh while others wait.
2. **Database Insertion Flow:** Unit tests mapping a mocked OAuth callback payload through `OAuthCallbackController` to ensure `EncryptionService` is invoked and `app_connection` is populated accurately.
3. **NexiomHttpClient:** Unit tests for each `authType` strategy (Bearer, API Key, Basic Auth).

### Goal 1 End-to-End Verification (Popup OAuth)

1. Seed Salesforce and QuickBooks into the `providers` table.
2. Add `SALESFORCE_CLIENT_ID/SECRET` and `QUICKBOOKS_CLIENT_ID/SECRET` to `.env`.
3. Login to the web dashboard → navigate to the Integrations Marketplace.
4. Click "Connect" on the Salesforce card:
   * Popup opens → Salesforce login → OAuth grants permissions.
   * Callback handled → `app_connection` row inserted with `status = ACTIVE`.
   * Popup closes → main window shows success toast.
5. Repeat for QuickBooks (verify `realmId` is stored in `metadata`).
6. Query the database to confirm credentials are encrypted and `expiresAt` is set.
7. Simulate token expiration → verify `TokenManagerService` auto-refreshes before next execution.

### Goal 2 End-to-End Verification (Action Execution)

1. With a live Salesforce connection: call `POST /execute/salesforce/createContact` with test props.
   * Verify contact appears in the Salesforce CRM sandbox.
2. With a live QuickBooks connection: call `POST /execute/quickbooks/createInvoice` with test props.
   * Verify invoice appears in the QuickBooks Online sandbox.
3. Token expiry simulation: expire the token in the DB → confirm `TokenManagerService` silently refreshes and the action still succeeds.
