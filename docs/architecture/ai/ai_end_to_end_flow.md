# Soopa End-to-End Flow (AWS)

## Overview
This document describes the complete end-to-end execution flow of Soopa running on AWS, from user request to final response, optimized for scalability, performance, and cost.

---

# 1. High-Level Flow

```
Client
  ↓
API Gateway
  ↓
Lambda (Router + Planner)
  ↓
Decision: Sync vs Async
  ↓
---------------------------------
| Sync Path                      |
| Async Path                     |
---------------------------------
```

---

# 2. Step-by-Step Flow

## Step 1 — Client Request
- User sends query (UI / API)
- Example: "Give me details of load 215236"

---

## Step 2 — API Gateway
- Entry point
- Handles authentication, throttling

---

## Step 3 — Lambda (Router + Query Planner)

### Responsibilities
- Detect category (TMS, Accounting)
- Identify intent (summary, financial, execution)
- Select tool
- Decide sync vs async

### Output Example
```json
{
  "category": "TMS",
  "intent": "summary",
  "tool": "getLoadSummary",
  "mode": "sync"
}
```

---

# 3. Sync Path (Fast Queries)

## Step 4 — Cache Check (Redis / ElastiCache)

- Check transformed cache
- Key: tenant:category:entity:id:viewMode

### If Cache Hit
→ Return immediately

### If Cache Miss
→ Continue

---

## Step 5 — Connector Call

- Fetch raw data from external app
- Example: Salesforce (Revenova)

---

## Step 6 — Transformation Layer

- Convert raw → canonical schema
- Reduce payload size

---

## Step 7 — LLM Processing

- Input: minimal structured data
- Output: natural language response

---

## Step 8 — Cache Storage

- Store transformed data
- Optionally store LLM response

---

## Step 9 — Response to Client

---

# 4. Async Path (Heavy Queries)

## Trigger Conditions
- Large data
- Cross-category queries
- Batch operations

---

## Step 4 — Push to Queue (SQS)

```ts
queue.add({ query, tenantId });
```

---

## Step 5 — Worker Processing (ECS / Lambda)

- Fetch data
- Transform
- Perform reasoning

---

## Step 6 — Store Result

- DynamoDB (metadata)
- S3 (large payloads)

---

## Step 7 — Notify Client

Options:
- Polling API
- Webhook
- WebSocket

---

# 5. Cross-Category Flow

## Example
"Compare load margin vs invoice payment"

### Flow

```
Planner
  ↓
Fetch TMS data
Fetch Accounting data
  ↓
Transform both
  ↓
Merge context
  ↓
LLM reasoning
```

---

# 6. Data Flow Summary

```
Raw Data (App)
  ↓
Connector
  ↓
Transformer
  ↓
Canonical Data
  ↓
LLM
  ↓
Response
```

---

# 7. Performance Optimizations

- Cache-first strategy
- Async for heavy workloads
- Minimal payload to LLM
- Parallel data fetch for multi-category

---

# 8. Failure Handling

## Connector Failure
- Retry
- Fallback to cache

## LLM Failure
- Return structured data

## Timeout
- Move to async processing

---

# 9. Observability

Track:
- Latency per step
- Token usage
- Cache hit rate
- Queue depth

---

# 10. Security Flow

- Tenant validation at API Gateway
- Scoped credentials per connector
- No cross-tenant data access

---

# Final Summary

This flow ensures:
- Efficient request handling
- Smart routing (sync vs async)
- Minimal token usage
- High scalability on AWS

Result:
A robust, enterprise-grade AI execution pipeline.

