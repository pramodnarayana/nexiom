## 1. Directory Structure

The repository follows a standard **Turborepo** layout. We strictly separate **SaaS Modules (Generic)** from the **Engine (Specific)**.

```text
/fluxnex-monorepo
│
├── /apps                                     # 🚀 DEPLOYABLE SERVICES
│   ├── /web                                  # 🟢 Unified Dashboard (Refine + React + Vite)
│   │   ├── /src
│   │   │   ├── /components                   # Shared UI
│   │   │   │   ├── /ui                       # Shadcn Primitives (Button, Table)
│   │   │   │   └── /layout                   # Sidebar, Header
│   │   │   ├── /modules                      # 📦 DOMAIN MODULES (Frontend Logic)
│   │   │   │   ├── /identity                 # 🆔 Unified Identity UI
│   │   │   │   │   ├── /auth                 # Login, Register forms
│   │   │   │   │   ├── /users                # User List, Invite Modal
│   │   │   │   │   └── /tenants              # Org Settings, Create Tenant
│   │   │   │   ├── /billing                  # Plan Selection, Invoices
│   │   │   │   ├── /notifications            # Channel Config
│   │   │   │   └── /engine                   # ⚙️ Integration UI
│   │   │   │       ├── /connections          # Wizard & Marketplace
│   │   │   │       └── /trace                # Activity Log
│   │   │   ├── /pages                        # Route Definitions
│   │   │   │   ├── /auth/*                   # Public Routes
│   │   │   │   ├── /app/*                    # Customer Routes
│   │   │   │   └── /admin/*                  # Super Admin Routes
│   │   │   ├── /providers                    # Refine Data/Auth Providers
│   │   │   ├── App.tsx
│   │   │   └── index.tsx
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── /api                                  # 🔵 Backend API (NestJS)
│       ├── /src
│       │   ├── /modules                      # 📦 API MODULES
│       │   │   ├── /identity                 # 🆔 Unified Identity API
│       │   │   │   ├── auth.controller.ts    # Login / Session Endpoints
│       │   │   │   ├── user.controller.ts    # Profile / Invites Endpoints
│       │   │   │   └── tenant.controller.ts  # Org / Schema Endpoints
│       │   │   ├── /billing                  # Billing Controller
│       │   │   └── /engine                   # ⚙️ Integration API
│       │   │       ├── /webhooks             # Ingestion Endpoint
│       │   │       ├── /connections          # OAuth Handshake
│       │   │       └── /dashboard            # Stats & Logs
│       │   ├── /common
│       │   │   ├── /guards                   # AuthGuard, TenantGuard
│       │   │   └── /decorators               # @CurrentUser()
│       │   ├── app.module.ts
│       │   └── main.ts
│       ├── package.json
│       └── tsconfig.json
│
├── /packages                                 # 📦 SHARED LIBRARIES (The Framework)
│   ├── /identity                             # 🆔 IDENTITY KERNEL (Auth + Users + Tenants)
│   │   ├── /src
│   │   │   ├── /auth                         # Better-Auth Config
│   │   │   │   ├── client.ts
│   │   │   │   └── session.ts
│   │   │   ├── /tenants                      # Multi-Tenancy Logic
│   │   │   │   ├── service.ts                # Provision new schema
│   │   │   │   └── context.ts                # AsyncLocalStorage Wrapper
│   │   │   └── /users                        # User Logic
│   │   │       ├── roles.ts                  # RBAC Definitions
│   │   │       └── invites.ts                # Invite Logic
│   │   └── package.json
│   │
│   ├── /billing                              # 💰 Monetization
│   │   ├── /src
│   │   │   └── lago.ts                       # Lago Client
│   │   └── package.json
│   │
│   ├── /notifications                        # 🔔 Alerts
│   │   ├── /src
│   │   │   └── novu.ts                       # Novu Client
│   │   └── package.json
│   │
│   ├── /engine                               # ⚙️ THE SYNC KERNEL
│   │   ├── /src
│   │   │   ├── /workers                      # SQS Consumers
│   │   │   │   ├── ingestion.ts              # Layer 1
│   │   │   │   ├── replica.ts                # Layer 2
│   │   │   │   ├── normalization.ts          # Layer 3
│   │   │   │   ├── outbound.ts               # Layer 4
│   │   │   │   ├── delivery.ts               # Layer 5
│   │   │   │   └── fetcher.ts                # Layer 6
│   │   │   ├── /loader                       # Dynamic Plugin Loader
│   │   │   ├── /connectivity                 # Grant / OAuth Logic
│   │   │   └── /security                     # Arcjet Rate Limiting
│   │   └── package.json
│   │
│   ├── /database                             # 💾 Data Access
│   │   ├── /src
│   │   │   ├── /schema
│   │   │   │   ├── public.ts                 # Users, Orgs schema
│   │   │   │   └── tenant.ts                 # Gateway, Replica schema
│   │   │   └── client.ts                     # Drizzle Client Factory
│   │   └── package.json
│   │
│   └── /domain                               # 📚 Canonical Types
│       ├── /src
│       │   ├── /types                        # TMSVendor, TMSInvoice
│       │   └── /utils                        # formatting.ts
│       └── package.json
│
├── /integrations                             # 🔌 BUSINESS LOGIC PLUGINS
│   ├── /revenova
│   │   ├── /src
│   │   │   ├── /replica                      # Layer 2 Logic
│   │   │   │   └── replica.ts
│   │   │   ├── /normalization                # Layer 3 Logic
│   │   │   │   ├── router.ts
│   │   │   │   ├── vendor.ts
│   │   │   │   └── invoice.ts
│   │   │   ├── /migrations                   # App-Specific SQL
│   │   │   └── /auth                         # Config
│   │   └── package.json
│   │
│   ├── /quickbooks
│   │   ├── /src
│   │   │   ├── /outbound                     # Layer 4 Logic
│   │   │   │   ├── vendor.ts
│   │   │   │   └── bill.ts
│   │   │   └── /migrations
│   │   └── package.json
│   │
│   └── /hubspot
│       └── ...
│
├── /infrastructure                           # 🏗️ DevOps
│   ├── /terraform
│   └── /docker
│
├── package.json
└── turbo.json
