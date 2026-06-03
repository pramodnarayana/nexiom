# Nexiom Repository Directory Structure (Option 2 - App Shell Pattern)

This document outlines the proposed full unified structure for the Nexiom monorepo. It aligns with the **Application Shell** pattern for frontend and a standard modular monolith for backend, ensuring strict separation of core infrastructure from pluggable SaaS modules.

## Full Directory Structure

```text
/fluxnex-monorepo (Root)
│
├── /apps                                     # 🚀 DEPLOYABLE SERVICES
│   │
│   ├── /web                                  # 🟢 Unified Dashboard (React + Vite)
│   │   ├── /src
│   │   │   ├── /app                          # ⚡️ THE SHELL (Infrastructure)
│   │   │   │   ├── /routes                   # AppRouter, AuthRoutes, TenantRoutes
│   │   │   │   ├── /providers                # AuthProvider, ThemeProvider
│   │   │   │   ├── /layouts                  # AdminLayout, TenantLayout
│   │   │   │   └── App.tsx                   # Shell Entry Point
│   │   │   │
│   │   │   ├── /modules                      # 📦 FRONTEND MODULES (Feature Domains)
│   │   │   │   ├── /identity                 # 🆔 Identity UI (Login, Users)
│   │   │   │   ├── /billing                  # 💰 Billing UI
│   │   │   │   └── /notifications            # 🔔 Notifications UI
│   │   │   │
│   │   │   ├── /shared                       # 🧩 SHARED TOOLKIT
│   │   │   │   ├── /components               # Generic UI (Buttons, Tables)
│   │   │   │   ├── /hooks                    # Generic Hooks
│   │   │   │   └── /lib                      # Utils & Constants
│   │   │   │
│   │   │   └── main.tsx                      # Bootstrapper
│   │   └── ...config files (vite.config.ts)
│   │
│   ├── /api                                  # 🔵 BACKEND API (NestJS)
│   │   ├── /src
│   │   │   ├── /app                          # ⚡️ API SHELL (Global Config)
│   │   │   │   ├── app.module.ts             # Main Module
│   │   │   │   └── main.ts                   # Entry Point
│   │   │   │
│   │   │   ├── /modules                      # 📦 BACKEND MODULES (Feature Controllers)
│   │   │   │   ├── /identity                 # 🆔 Identity Controllers
│   │   │   │   ├── /billing                  # 💰 Billing Controllers
│   │   │   │   └── /engine                   # ⚙️ Sync Engine Controllers
│   │   │   │
│   │   │   └── /common                       # 🧩 SHARED API UTILS
│   │   │       ├── /guards                   # Auth Guards
│   │   │       └── /decorators               # User Decorators
│   │   └── ...config files
│
├── /packages                                 # 📦 SHARED LIBRARIES (The Framework Kernels)
│   │                                           → Core business logic shared across microservices/apps
│   ├── /identity                             # 🆔 IDENTITY KERNEL
│   │   ├── /src                              # (Auth Adapter, User Service, Tenant Service)
│   │   └── package.json
│   │
│   ├── /billing                              # 💰 BILLING KERNEL
│   │   ├── /src                              # (Lago Adapter, Subscription Logic)
│   │   └── package.json
│   │
│   ├── /notifications                        # 🔔 NOTIFICATION KERNEL
│   │   ├── /src                              # (Novu Adapter, Channel Logic)
│   │   └── package.json
│   │
│   ├── /engine                               # ⚙️ SYNC ENGINE KERNEL
│   │   ├── /src                              # (Workers, ETL Logic, Connectors)
│   │   └── package.json
│   │
│   ├── /database                             # 💾 DATA ACCESS LAYER
│   │   ├── /src                              # (Drizzle Schema, DB Client)
│   │   └── package.json
│   │
│   └── /domain                               # 📚 CANONICAL TYPES
│       ├── /src                              # (Shared Interfaces, DTOs)
│       └── package.json
│
├── /integrations                             # 🔌 CONNECTORS (External Logic)
│   ├── /revenova
│   ├── /quickbooks
│   └── /hubspot
│
└── /infrastructure                           # 🏗 DevOps Scripts
    ├── /terraform
    └── /docker
```

## How It Works for Open Source SaaS

1. **Batteries Included:** The "Platform" (`apps`, `packages/identity`, `packages/database`, `packages/billing`) provides a working SaaS out of the box.
2. **Extensible:** Developers add new features by creating a new folder in `/modules` (frontend) and `/modules` (backend), or by adding a new `/integration`.
3. **Modular:** Core features like Billing or Identity can be swapped out by replacing the respective `@soopa/billing` or `@soopa/identity` package implementations while keeping the API contracts (in `/domain`) the same.
