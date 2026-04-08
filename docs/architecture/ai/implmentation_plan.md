Enterprise Implementation Plan: Standalone AI (Hybrid Proxy)
This plan outlines the integration of the AI Copilot utilizing the Vercel AI SDK + Generative UI. It leverages a Hybrid Architecture: the backend tightly orchestrates the LLM logic for minimum latency, whilst internally adhering to the Model Context Protocol (MCP) tool schemas to dynamically expose the user's exact live SaaS connections.

User Review Required
IMPORTANT

The architecture is now aligned under a Hybrid Orchestrator. The NestJS Backend natively connects to the LLM (bypassing slow SSE network hops internally), strictly pulling tools generated on-the-fly based on the user's active OAuth connections. Please review Phase 2 before we start coding.

Proposed Changes
Phase 1: Tool Registry & Dynamic Connection Resolving
Before the LLM is even invoked, the system dynamically generates allowed actions based entirely on the user's active integrations (preventing hallucinated tool executions).

[NEW] engine/platform/core/src/mcp/builder/mcp-schema-builder.service.ts
Dynamic Security: Maps Piece framework Actions to standard AI SDK Tool definitions, but only doing so for the specific app_connection records the user holds.
Context Injection: Access Tokens are fetched on-the-fly from the Vault locally and injected directly into the Proxy Execution closure (bypassing the LLM).
Audit Logging: Each tool invocation drops a strict execution boundary logger for SOC2/GDPR compliance.
Phase 2: The Orchestrator Backend (NestJS locally runs LLM)
By running the LLM orchestrator alongside the database, we instantly resolve the tenant's connections and execute tools entirely in-memory for lightning-fast Generative UI.

[NEW] apps/api/src/modules/ai/_controllers/ai.controller.ts
Exposes POST /api/ai/chat.
Accepts the standard messages array from Vercel's useChat.
Connection Awareness: Queries the public database to discover active SaaS Connections for the current user's org.
Configures @ai-sdk/google (Gemini) by passing it the dynamic array of allowed connection tools native to that org.
Spawns streamText() and returns a standard Response.toDataStreamResponse().
[MODIFY] apps/api/package.json
Add @ai-sdk/google, ai, and zod to @apps/api dependencies.
Phase 3: Generative Business UI (React Frontend)
[NEW] apps/web/src/modules/ai/components/chat/AiChat.tsx
Implement Vercel AI SDK useChat hook, pointing straight to /api/ai/chat.
Intelligently observes the toolInvocations array. When status is fetching, drops in Skeleton UI states to heavily mask API latency.
[NEW] apps/web/src/modules/ai/components/cards/
Dynamic templates such as LoadCard.tsx and InvoiceCard.tsx that intercept specified external API proxies and render them nicely into the feed instead of plaintext JSON.
Phase 4: Enterprise Hardening (Resiliency & Observability)
[NEW] apps/api/src/modules/ai/_interceptors/ai-telemetry.interceptor.ts
Telemetry & Tracing: Propagates trace_id through the LLM call into the actual piece execution for pristine upstream visibility if a provider like Salesforce rate limits the proxy.
[MODIFY] apps/api/src/modules/ai/ai.module.ts
Rate Limiters: Aggressive token-bucket rate limits on the /chat endpoint to shield against runaway LLM billing.
Circuit Breakers: Wrapping upstream SaaS API calls through opossum to catch timeouts and advise the user gracefully.
Directory Structure (Domain-Driven Design)
text
# Backend (Hybrid Orchestrator API)
apps/api/src/modules/ai/
├── ai.module.ts
├── _controllers/
│   ├── ai.controller.ts                 # Vercel streamText HTTP boundaries
├── _services/
│   └── orchestrator.service.ts          # LLM loop and dynamic tool resolver based on OAuth
├── _interceptors/
│   ├── ai-telemetry.interceptor.ts      # OpenTelemetry bounds
│   └── ai-ratelimit.guard.ts            # Token-bucket LLM chat throttling
└── _adapters/
    ├── proxy-executor.adapter.ts        # Fuses tool definition with JIT token bounds
# Engine Core (Adaptable Schemas)
engine/platform/core/src/mcp/
├── builder/
│   └── mcp-schema-builder.service.ts    # Transforms pieces into AI tool objects
# Frontend (React Next-Gen UI)
apps/web/src/modules/ai/
├── components/
│   ├── chat/                            # Struct UI AI elements
│   └── cards/                           # GenUI specific object renderers
└── hooks/
    └── useAiStream.ts                   # Vercel SDK abstractions