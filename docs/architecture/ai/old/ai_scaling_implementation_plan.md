# Enterprise AI Copilot Implementation Plan (InstantDB + BullMQ)

This document dictates the structured execution plan to transition the existing Nexiom Copilot infrastructure to the heavily distributed, multi-region architecture defined in `ai_scaling.md`.

## Phase 1: Reactive Interface Layer (InstantDB)

We will configure InstantDB natively to synchronize the frontend with the detached worker grid.

### 1. InstantDB Global Configuration
*   **Target**: `apps/web/package.json`, `apps/api/package.json`
*   **Action**: Install `@instantdb/react` and `@instantdb/admin`.
*   **Target**: `apps/web/src/shared/lib/instant.ts`
*   **Action**: Implement the global frontend InstantDB connection client.

### 2. Thought Trace UI Component
*   **Target**: `apps/web/src/modules/ai/components/chat/ThoughtTrace.tsx`
*   **Action**: Create the reactive `ThoughtTrace` component to observe the `steps` collection via `db.useQuery()`, rendering status pulses as the remote worker executes the logic graph.

### 3. Copilot Chat Refactoring
*   **Target**: `apps/web/src/modules/ai/components/chat/AiChat.tsx`
*   **Action**: Sunset the standard HTTP Vercel `useChat` hook. Convert form submissions to write initial intents into the InstantDB `messages` collection and await reactive payload hydration for LLM responses.

## Phase 2: Orchestration & Queue Sharding (BullMQ)

The API Gateway will transition to a stateless delegator.

### 1. Redis & BullMQ Monorepo Setup
*   **Target**: `packages/queue/package.json`, `packages/queue/bullmq.service.ts`
*   **Action**: Initialize BullMQ explicitly. Construct a routing module capable of spawning and addressing dynamic queue shards (`CopilotQueue_${shard_id}`).

### 2. API Gateway Handoff
*   **Target**: `apps/api/src/modules/ai/controllers/ai.controller.ts`
*   **Action**: Remove `OrchestratorService.streamChat` invocations from the HTTP pipeline. The controller will strictly generate a `sessionId`, resolve the `tenant_id`, calculate the Shard Hash, and push the initial Payload to the correct BullMQ node. Returns `201 Accepted`.

## Phase 3: The Distributed Reasoning Grid

Deploy physical separation of Compute into Fast-Path and Heavy-Path Topologies.

### 1. Fast-Path Worker (Intent Classification)
*   **Target**: `apps/api/src/modules/ai/workers/fast-intent.worker.ts`
*   **Action**: Build a high-throughput Node.js worker strictly dedicated to evaluating the prompt against the JIT Tool Registry via Portkey (Gemini 1.5 Flash).
*   **Action**: Mutates InstantDB status (`IDENTIFYING_RECORD`). Yields the identified targets into the Heavy Worker queue.

### 2. Heavy-Path Worker (Live Fetch & Reasoning)
*   **Target**: `apps/api/src/modules/ai/workers/heavy-reasoning.worker.ts`
*   **Action**: Build a high-RAM worker utilizing Claude 3.5 Sonnet to handle the bloated context parsing.
*   **Action**: Sequentially accesses the Universal Trigger Proxy, updates InstantDB status markers (`FETCHING`, `PRUNING`, `SYNTHESIZING_RESPONSE`), and pushes the final processed LLM chunk stream back into InstantDB for GUI rendering.

## Phase 4: Shielding & Execution Plane (The Kernel)

Establish strict architectural guardrails to prevent external SaaS outages caused by automated Copilot loads.

### 1. The Global Connection Governor
*   **Target**: `packages/engine/src/security/governor.service.ts`
*   **Action**: Implement a "Leaky Bucket" Distributed Lock in Redis to govern the maximum allowed concurrent HTTPS connections to SaaS tools (like Salesforce) specifically per tenant.

### 2. The Truth Buffer Implementation
*   **Target**: `packages/piece-framework/src/universal-trigger.ts`
*   **Action**: Wrap external API invocations elegantly with a 60-second Redis TTL Cache Layer. If Worker A and Worker B request the exact same Salesforce Load ID within a minute, Worker B uses the Truth Buffer rather than dispatching an identical physical downstream network hit.
