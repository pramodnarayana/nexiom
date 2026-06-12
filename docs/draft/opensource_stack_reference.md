# Soopa Open Source Stack Reference

This document lists all the open-source libraries, frameworks, and infrastructure tools selected for the Soopa platform, categorized by their function.

## 1. Core Frameworks & Runtime

| Tool | Role in Soopa | GitHub Repository |
 | ----- | ----- | ----- |
| **Refine** | **Frontend Framework.** Rapid development of the internal dashboard and customer portal. Handles CRUD, routing, and state. | [refinedev/refine](https://github.com/refinedev/refine) |
| **NestJS** | **Backend Framework.** The modular architecture for the API Gateway and Core Engine. Enforces dependency injection and structure. | [nestjs/nest](https://github.com/nestjs/nest) |
| **React** | **UI Library.** The view layer for the frontend. | [facebook/react](https://github.com/facebook/react) |
| **Vite** | **Build Tool.** High-performance bundler for the React frontend. | [vitejs/vite](https://github.com/vitejs/vite) |
| **Turborepo** | **Monorepo Manager.** Orchestrates builds, linting, and testing across `apps/` and `packages/`. | [vercel/turbo](https://github.com/vercel/turbo) |

## 2. Identity & Authentication

| Tool | Role in Soopa | GitHub Repository |
 | ----- | ----- | ----- |
| **Better-Auth** | **User Identity.** Handles Sign-up, Login, Session Management, and Multi-Tenancy (Organizations). | [better-auth/better-auth](https://github.com/better-auth/better-auth) |
| **Grant** | **App Connectivity.** Middleware for handling OAuth2 handshakes (connecting QuickBooks, Salesforce, etc.) with 200+ providers. | [simov/grant](https://github.com/simov/grant) |
| **Activepieces** | **Connectivity Reference.** (Reference Only) Source code pattern for structuring OAuth token refresh logic and App Connection database schemas in TypeScript. | [activepieces/activepieces](https://github.com/activepieces/activepieces) |
| **Lucia** | **Low-Level Sessions.** (Alternative/Underlying) Flexible session management library if granular control is needed. | [lucia-auth/lucia](https://github.com/lucia-auth/lucia) |

## 3. Database & Data Access

| Tool | Role in Soopa | GitHub Repository |
 | ----- | ----- | ----- |
| **Drizzle ORM** | **ORM.** TypeScript-first Object Relational Mapper. Handles schema definitions and type-safe database queries. | [drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) |
| **PostgreSQL** | **Primary Database.** The relational database engine (Self-hosted or Aurora). | [postgres/postgres](https://github.com/postgres/postgres) |
| **Redis** | **Cache & Rate Limiting.** In-memory store used by rate-limiter-flexible for distributed counting and by BullMQ (if self-hosting queues). | [redis/redis](https://github.com/redis/redis) |

## 4. Platform Services (The "SaaS Kit")

| Tool | Role in Soopa | GitHub Repository |
 | ----- | ----- | ----- |
| **Lago** | **Billing & Metering.** Usage-based billing engine. Tracks sync events and manages subscriptions/invoices. | [getlago/lago](https://github.com/getlago/lago) |
| **Novu** | **Notifications.** Unified API for sending emails (SendGrid), Slack messages, and In-App alerts to users. | [novuhq/novu](https://github.com/novuhq/novu) |
| **Flagsmith** | **Feature Flags.** Remote configuration server to toggle features per tenant without redeploying code. | [Flagsmith/flagsmith](https://github.com/Flagsmith/flagsmith) |

## 5. Security & Infrastructure

| Tool | Role in Soopa | GitHub Repository |
 | ----- | ----- | ----- |
| **rate-limiter-flexible** | **App Rate Limiting.** Powerful Node.js rate limiter (Token Bucket, Leaky Bucket) backed by Redis. Enforces tenant-specific plans (Starter vs Enterprise) within NestJS guards. | [animir/node-rate-limiter-flexible](https://github.com/animir/node-rate-limiter-flexible) |
| **Nginx** | **Ingress & Infra Limiting.** High-performance reverse proxy. Handles SSL termination and coarse-grained IP rate limiting before traffic hits the API. | [nginx/nginx](https://github.com/nginx/nginx) |
| **CrowdSec** | **Bot Protection.** Intrusion prevention system to protect public ingestion endpoints from abuse and scraping. | [crowdsecurity/crowdsec](https://github.com/crowdsecurity/crowdsec) |
| **class-validator** | **Email & Input Validation.** Decorator-based validation for DTOs. Handles email format verification and sanitization. | [typestack/class-validator](https://github.com/typestack/class-validator) |
| **OpenTofu** | **IaC.** Open-source fork of Terraform for defining AWS infrastructure as code. | [opentofu/opentofu](https://github.com/opentofu/opentofu) |
| **Pulumi** | **IaC (Alternative).** Infrastructure as Code using TypeScript. | [pulumi/pulumi](https://github.com/pulumi/pulumi) |
| **LocalStack** | **Local Dev.** Emulates AWS services (SQS, S3, Lambda, KMS) locally in Docker. | [localstack/localstack](https://github.com/localstack/localstack) |

## 6. Observability (New)

| Tool | Role in Soopa | GitHub Repository |
| :--- | :--- | :--- |
| **SigNoz** | **Full Stack Observability.** Open Source alternative to Datadog. Handles Traces, Metrics, and Logs in a single dashboard. | [SigNoz/signoz](https://github.com/SigNoz/signoz) |
| **OpenTelemetry** | **Instrumentation.** Standard for generating traces in NestJS workers to send to SigNoz. | [open-telemetry/opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js) |

## 7. Testing & Quality

| Tool | Role in Soopa | GitHub Repository |
 | ----- | ----- | ----- |
| **Vitest** | **Unit Testing.** Fast unit test runner for Vite projects. Used for Frontend and Kernel logic. | [vitest-dev/vitest](https://github.com/vitest-dev/vitest) |
| **Playwright** | **E2E Testing.** Reliable end-to-end testing for critical user flows (Login, Connect App). | [microsoft/playwright](https://github.com/microsoft/playwright) |
| **MSW** | **API Mocking.** Mock Service Worker. Intercepts network requests to mock QuickBooks/Salesforce during tests. | [mswjs/msw](https://github.com/mswjs/msw) |
| **Act** | **CI Simulation.** Run GitHub Actions workflows locally. | [nektos/act](https://github.com/nektos/act) |

## 8. AI & Test Generation Tools (New)

| Tool | Role in Soopa | GitHub Repository / Link |
 | ----- | ----- | ----- |
| **CodiumAI** | **Unit/Logic Test Generation.** IDE extension that analyzes code behavior and generates edge-case tests (Jest/Vitest) automatically. | [CodiumAI (Free Tier)](https://www.codium.ai/) |
| **Playwright Codegen** | **E2E Test Recording.** Built-in CLI tool to record browser interactions and generate TypeScript test code instantly. | [microsoft/playwright](https://playwright.dev/docs/codegen) |
| **Keploy** | **API Regression Testing.** "No-Code" testing platform that records API traffic and converts it into test cases and mocks. | [keploy/keploy](https://github.com/keploy/keploy) |

## 9. UI Components

| Tool | Role in Soopa | GitHub Repository |
 | ----- | ----- | ----- |
| **shadcn/ui** | **Component Library.** Copy-paste accessible components based on Radix UI. | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) |
| **tweakcn** | **Theming Engine.** Utility for managing and customizing Tailwind themes dynamically. | [tweakcn](https://tweakcn.com) |
| **Lucide React** | **Icons.** Beautiful, consistent icon set. | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) |
| **Tailwind CSS** | **Styling.** Utility-first CSS framework. | [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) |
