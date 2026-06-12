# Soopa AI Refactor Implementation Plan

## Overview
This document provides a step-by-step, repo-aligned implementation plan to refactor the existing `engine/ai` module into a scalable, token-efficient, enterprise-grade architecture.

---

# 1. Current State (Problems)

## Issues
- Direct injection of raw tool responses into LLM
- Single monolithic tool (`getEntityWithRelations`)
- No transformation layer
- No query planner
- No category abstraction
- High token usage (3K–6K per request)

---

# 2. Target Architecture

```
Query → Planner → Tool → Transformer → LLM
```

---

# 3. Target Folder Structure

```
engine/ai/
  ├── planner/
  ├── tools/
  ├── transformers/
  ├── categories/
  ├── runtime/
  ├── contracts/
  └── observability/
```

---

# 4. Phase-wise Implementation

---

## Phase 1 — Introduce Transformation Layer (HIGH PRIORITY)

### Step 1.1 Create Transformer

File:
```
engine/ai/transformers/tms/salesforce.ts
```

```ts
export function transformSalesforceLoad(raw: any) {
  const l = raw.rtms__Load__c;

  return {
    number: l.Name,
    status: l.rtms__Load_Status__c,
    origin: l.rtms__Origin__c,
    destination: l.rtms__Destination__c,
  };
}
```

---

### Step 1.2 Wrap Existing Tool Output

```ts
const raw = await salesforce.getEntityWithRelations(...);

const transformed = transformSalesforceLoad(raw);

return transformed;
```

---

### Outcome
- Immediate token reduction (~70%)

---

## Phase 2 — Split Tools (Remove Monolith)

### Replace
```
getEntityWithRelations ❌
```

### With
```
engine/ai/tools/tms/
  getLoadSummary.ts
  getLoadFinancials.ts
  getLoadExecution.ts
```

---

### Example Tool

```ts
export async function getLoadSummary({ loadId }) {
  const raw = await salesforce.getLoad(loadId);
  return transformSalesforceLoad(raw);
}
```

---

### Outcome
- Controlled payload size
- Reduced unnecessary data fetching

---

## Phase 3 — Introduce Query Planner

### File
```
engine/ai/planner/query_planner.ts
```

```ts
export function planQuery(query: string) {
  const q = query.toLowerCase();

  const loadId = q.match(/\b\d{5,}\b/)?.[0];

  if (q.includes("invoice") || q.includes("margin")) {
    return {
      category: "TMS",
      intent: "financial",
      tool: "getLoadFinancials",
      params: { loadId },
    };
  }

  return {
    category: "TMS",
    intent: "summary",
    tool: "getLoadSummary",
    params: { loadId },
  };
}
```

---

### Outcome
- Avoid unnecessary tool calls

---

## Phase 4 — Category Registry

### File
```
engine/ai/categories/index.ts
```

```ts
export const categoryMap = {
  TMS: {
    salesforce: transformSalesforceLoad,
  },
};
```

---

## Phase 5 — Runtime Orchestrator

### File
```
engine/ai/runtime/ai_runtime.ts
```

```ts
export async function handleAIQuery(query: string) {
  const plan = planQuery(query);

  const raw = await tools[plan.tool](plan.params);

  const transformed = raw; // already transformed in tool

  return callLLM(transformed);
}
```

---

## Phase 6 — Token Guard

```ts
function enforceSize(data: any) {
  const size = JSON.stringify(data).length;

  if (size > 2000) {
    throw new Error("Payload too large");
  }
}
```

---

## Phase 7 — Observability

### File
```
engine/ai/observability/logger.ts
```

```ts
log({
  query,
  tool: plan.tool,
  payload_size: JSON.stringify(transformed).length,
});
```

---

# 5. Migration Strategy

## Phase 1
- Add transformer
- Wrap existing tool

## Phase 2
- Introduce planner
- Route new queries

## Phase 3
- Replace monolithic tool

---

# 6. What to Remove

- Direct raw JSON to LLM
- getEntityWithRelations usage
- App-specific field exposure to LLM

---

# 7. Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Tokens | 3K–6K | 100–300 |
| Cost | High | Low |
| Latency | High | Lower |

---

# 8. Immediate Action

Implement:

```ts
const raw = await salesforce.getEntityWithRelations(...);

const transformed = transformSalesforceLoad(raw);

return transformed;
```

---

# Final Summary

This refactor introduces:
- Transformation layer
- Planner
- Modular tools
- Runtime orchestration

Result:
A scalable, efficient AI system aligned with Soopa architecture.

