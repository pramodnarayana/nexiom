# Nexiom Platform

> **B2B Integration & Data Platform (iPaaS)**
> *The Engine for Modern Business Connectivity*

Nexiom separates the **Platform Infrastructure** (The Engine) from the **Integration Logic** (The Connectors), allowing for scalable, secure, and maintainable B2B integrations.

---

## 🏗️ Architecture

This project is a high-performance **Monorepo** managed by [Turborepo](https://turbo.build/).

| Layer | Technology | Description |
| :--- | :--- | :--- |
| **Monorepo** | **Turborepo** | Build system & orchestrator |
| **Frontend** | **React + Vite** | `apps/web` (Dashboard / Admin Desk) |
| **Backend** | **NestJS** | `apps/api` (API Gateway / Control Plane) |
| **Database** | **PostgreSQL** | Multi-tenant data storage (via Drizzle ORM) |
| **Auth** | **Better-Auth** | Secure, self-hosted authentication |
| **Email** | **Nodemailer** | Transactional email infrastructure |

---

## 🛡️ Production Standards

We enforce strict quality gates to ensure reliability and maintainability.

- **Linting:** Zero-tolerance policy. CI fails on any warning.
- **Type Safety:** Strict TypeScript configuration. No `any` allowed.
- **Testing:**
  - Global Coverage Threshold: **60%** (Enforced)
  - Unit Tests required for all Controllers & Services.
- **Git Hooks:**
  - `pre-commit`: Runs Lint & Test Coverage automatically.

---

## 🚀 Getting Started

### 1. Prerequisites

- Node.js v18+
- Docker (for Database)
- pnpm

### 2. Setup

```bash
# Install dependencies
pnpm install

# Setup Environment
cp .env.example .env

# Fully provision all local infrastructure (Docker, Database migrations, & Seed data)
pnpm setup:local
```

### 3. Hard Reset (Optional)

If you ever need to completely wipe your local environment and databases to start fresh from a perfect state:

```bash
pnpm infra:reset
```

### 4. Development
Launch the full stack in parallel:
```bash
pnpm dev
```

#### Lightweight Mode (API & Web only)
If you are only working on API endpoints (e.g. AI Copilot) and don't want background queues (LocalStack/Windmill) consuming RAM or spamming connection logs:
```bash
# Provision only lightweight containers (Postgres, Redis, Mock-Gateway)
pnpm setup:light

# Run only the API and Web processes
pnpm dev:light
```

- **Web:** [http://localhost:5173](http://localhost:5173)
- **API:** [http://localhost:3000](http://localhost:3000)
- **DB Studio:** [https://local.drizzle.studio](https://local.drizzle.studio)

---

## 🤝 Workflow

We use **Trunk-Based Development** with short-lived feature branches targeting `development`.

1. Start from Dev: `git checkout development && git pull`
2. Create branch: `git checkout -b feature/xyz`
3. Commit changes.
4. Open Pull Request -> `development`.
5. **AI Review:** CodeRabbit analyzes.
6. Merge to `development`.
7. Release: Merge `development` -> `master`.
