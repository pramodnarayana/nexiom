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

# Start Database
docker-compose up -d

# Push Schema
pnpm --filter api db:push
```

### 3. Development
Launch the full stack in parallel:
```bash
pnpm dev
```
- **Web:** [http://localhost:5173](http://localhost:5173)
- **API:** [http://localhost:3000](http://localhost:3000)
- **DB Studio:** [https://local.drizzle.studio](https://local.drizzle.studio)

---

## 🤝 Workflow
We use **Trunk-Based Development** with short-lived feature branches.

1.  Create branch: `git checkout -b feature/xyz`
2.  Commit changes.
3.  Open Pull Request -> `development`.
4.  **AI Review:** CodeRabbit analyzes.
5.  Merge to `development`.
6.  Release: Merge `development` -> `master`.
