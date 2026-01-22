# Nexiom Technical Plan: The SaaS Framework Strategy (v6.0)

## 1. The Core Philosophy

**Nexiom** is two things:

1. **A Universal SaaS Framework**: A set of drop-in modules for Multi-Tenancy, Billing, and Notifications that any B2B product needs.
2. **An Integration Platform**: A reference implementation built *on top* of the framework.

**The Promise:** A developer can fork this repo, delete the `/integration-engine` folder, and instantly have a production-ready SaaS starter kit for *their* specific business idea.

## 2. Directory Structure (Decoupled)

We strictly separate **SaaS Plumbing** from **Business Logic**.

```text
/fluxnex-monorepo
│
├── /apps                     # 🚀 Deployable Services
│   ├── /web                  # Frontend (Refine + React + Vite)
│   │   ├── /src/modules/saas # Generic UI (Login, Billing, Settings)
│   │   └── /src/modules/app  # Business UI (Connections, Dashboard)
│   │
│   ├── /api                  # Backend Server (NestJS)
│       ├── /src/saas-modules # Generic API (Auth, Users, Webhooks)
│       └── /src/app-modules  # Business API (Sync, Pipeline)
│
├── /packages                 # 📦 Shared Libraries
│   ├── /saas-core            # 🛠️ THE UNIVERSAL SAAS FRAMEWORK
│   │   # This package knows NOTHING about "Syncs" or "QuickBooks"
│   │   ├── /auth             # Better-Auth + Context logic
│   │   ├── /tenancy          # Schema Provisioning Logic
│   │   ├── /billing          # Lago / Stripe Integration
│   │   ├── /notifications    # Novu Integration
│   │   └── /feature-flags    # Flagsmith Integration
│   │
│   ├── /integration-engine   # ⚙️ THE BUSINESS LOGIC (Your Product)
│   │   # This uses saas-core but contains specific domain logic
│   │   ├── /workers          # SQS Consumers (Layer 1-6)
│   │   ├── /loader           # Dynamic Plugin Loader
│   │   └── /services         # Connection Manager
│   │
│   ├── /database             # Schema Definitions
│   │   ├── /public           # SaaS Tables (Users, Orgs)
│   │   └── /tenant           # App Tables (Gateway, Normalized)
│   │
│   └── /ui-kit               # Shared React Components
│
├── /integrations             # 🔌 Plugins (Business Logic)
│   ├── /revenova
│   ├── /quickbooks
│   └── /hubspot
│
├── /infrastructure           # Terraform & Docker
