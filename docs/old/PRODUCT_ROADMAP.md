# Nexiom Product Roadmap

## 1. Product Vision
**Nexiom** is a **B2B Integration & Data Platform (iPaaS)** designed for small-to-medium businesses.
It separates the **Platform Infrastructure** (The Engine) from the **Integration Logic** (The Connectors).

---

## 2. Architecture (The "Stack")
*   **Monorepo:** Turborepo
*   **Frontend (`apps/web`):** React + Vite (Dashboard / Admin Desk)
*   **Backend (`apps/api`):** NestJS (API Gateway / Platform Control Plane)
*   **Database:** PostgreSQL (Tenants, Sync State) + Redis (Job Queues)

---

## 3. Implementation Phases

### Phase 1: Foundation & Identity (Current)
*   [x] **Monorepo Setup:** Turborepo, Shared Types.
*   [x] **Frontend:** React Shell, Auth Routing.
*   [x] **Authentication:** Zitadel OIDC Integration.

### Phase 2: The "Desk" Core (User & Tenant Mgmt)
*   [ ] **Platform Dev:**
    *   Build "Admin API" (NestJS) for User/Role Management.
    *   Implement "Tenant Context Middleware" (ensure isolation).
*   [ ] **App Dev:**
    *   Configure default Roles (Admin, Editor, Viewer).

---

### Phase 3: Integration Engine (The Connectors)
This phase builds the capability to *connect* to systems.

#### 🔧 Platform Developer (The Engine)
*   **Credential Vault:** Secure storage (AES-256) for OAuth/API Keys.
*   **OAuth System:** Centralized "Redirect Handler" that accepts callbacks (`/api/callback/quickbooks`) and stores tokens.
*   **Connection Health:** Background job to check if Tokens are expired and refresh them automatically.

#### 📦 Application Developer (The Connectors)
*   **QuickBooks Connector:** Implement `ICredentialType` for OAuth2.
*   **Salesforce Connector:** Implement `ICredentialType` for OAuth2.
*   **Revenova Connector:** Implement `ICredentialType` for API Key.

---

### Phase 4: Sync Orchestration (The Pipeline)
This phase builds the capability to *move* data.

#### 🔧 Platform Developer (The Pipeline)
*   **Layer 1 (Gateway):** Generic Webhook Ingestor -> SQS/Redis.
*   **Layer 2 (Replica):** Generic Worker that loads an "App Parser".
*   **Layer 3 (Normalize):** Generic Worker that loads an "App Mapper".
*   **Layer 5 (Delivery):** HTTP Executor with "Self-Healing" (Retry on 429, Refresh Token on 401).
*   **Observability:** "Sync History" Logger.

#### 📦 Application Developer (The Logic)
*   **Parsers:** Write `revenova/replica.ts` (XML -> JSON).
*   **Mappers:** Write `revenova/normalization.ts` (Source -> Canonical).
*   **Validators:** Write `quickbooks/outbound.ts` (Canonical -> QB JSON).

---

### Phase 5: DevOps & CI/CD Pipeline
Automating the "Factory" that builds the platform.

#### 🛠️ Pipeline Architecture (GitHub Actions)
*   **PR Checks:**
    *   `pnpm lint` (ESLint).
    *   `pnpm test:cov` (Jest w/ **Code Coverage**).
    *   `pnpm build` (Verify compilation).
*   **AI & Quality Gates:**
    *   **CodeRabbit:** Automated AI Code Reviews on every PR.
    *   **SonarCloud:** Static Analysis, Vulnerability Scanning, & Quality Gate.
    *   **Renovate:** Automated Dependency Updates (Monorepo-aware).
*   **Release Pipeline:**
    *   **Dockerize:** Build `apps/web` (NGINX) and `apps/api` (Node) images.
    *   **Registry:** Push to GHCR (GitHub Container Registry).
*   **Deployment (CD):**
    *   **Dev:** Auto-deploy `master` branch (e.g., via ArgoCD or SSH).
    *   **Prod:** Deploy strictly from SemVer Tags (`v1.0.0`).

---

## 4. Next Step: Phase 2.1 (User Management)
To enable the "Platform" to manage Tenants and Users, we perform **Phase 2** immediately.
1.  **Backend:** Create `apps/api/src/users` module.
2.  **Frontend:** Create "Invite User" Screen.
