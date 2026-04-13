# Nexiom Realtime UX & Progress Streaming Architecture (v2)

## Overview
This document defines how Nexiom provides realtime execution visibility to users while AI queries are being processed. It ensures a responsive UX without impacting core system performance or increasing token usage.

---

# 1. Objectives

Provide users with:
- Live execution status updates
- Progress indicators (0–100%)
- Stage-level messages (planning, fetching, etc.)
- Streaming AI responses (optional)

Constraints:
- No impact on LLM token usage
- No coupling with business data layer
- Minimal infrastructure overhead

---

# 2. Design Principles

## 2.1 Separation of Concerns
- Core system: DynamoDB, S3, Redis
- UX streaming: WebSocket / SSE layer

## 2.2 Event-Driven Updates
- Emit small status events
- Do NOT send full payloads

## 2.3 Non-blocking Execution
- Backend continues processing
- UI listens asynchronously

---

# 3. High-Level Architecture

```
Client UI
   ↓
API Gateway (WebSocket / SSE)
   ↓
Execution Engine (Lambda)
   ↓
Planner → Tool → Transformer → LLM
   ↓
DynamoDB (Job State)
   ↓
WebSocket Push
   ↓
Client Updates
```

---

# 4. Job State Model

## DynamoDB Table: job_execution

```ts
type Job = {
  job_id: string;
  tenant_id: string;
  status: string;
  progress: number;
  message?: string;
  error?: string;
  created_at: string;
  updated_at: string;
};
```

---

# 5. Status Lifecycle

| Stage | Status | Progress |
|------|--------|----------|
| Start | initiated | 0 |
| Planner | planning | 10 |
| Tool | fetching_data | 40 |
| Transform | transforming | 60 |
| LLM | generating_response | 80 |
| Done | completed | 100 |
| Error | failed | - |

---

# 6. Execution Flow

## Step 1 — Client Request
```
POST /api/query
```

Response:
```json
{ "job_id": "abc123" }
```

---

## Step 2 — Subscribe to Updates

WebSocket:
```
ws://.../jobs/{job_id}
```

---

## Step 3 — Emit Updates

### Planner
```ts
updateJob(job_id, { status: "planning", progress: 10 });
```

### Tool
```ts
updateJob(job_id, { status: "fetching_data", progress: 40 });
```

### Transform
```ts
updateJob(job_id, { status: "transforming", progress: 60 });
```

### LLM
```ts
updateJob(job_id, { status: "generating_response", progress: 80 });
```

### Complete
```ts
updateJob(job_id, { status: "completed", progress: 100 });
```

---

# 7. WebSocket Implementation (AWS)

## Components
- API Gateway (WebSocket API)
- Lambda (publisher)
- DynamoDB (connection mapping)

---

## Flow

```
Client connects
  ↓
Connection stored
  ↓
Execution updates job
  ↓
Lambda pushes update
```

---

## Example Push

```ts
await apiGateway.postToConnection({
  ConnectionId: connectionId,
  Data: JSON.stringify(update)
});
```

---

# 8. SSE Alternative

## Use when
- Simpler implementation needed
- No bidirectional communication required

## Example

```ts
res.write(`data: ${JSON.stringify(update)}\n\n`);
```

---

# 9. Polling Fallback

## Endpoint
```
GET /api/job/{job_id}
```

Used when WebSocket/SSE unavailable.

---

# 10. Streaming AI Response (Optional)

## Approach
- Send partial tokens via WebSocket/SSE
- Update message incrementally

---

# 11. Failure Handling

## Error
```ts
updateJob(job_id, {
  status: "failed",
  error: error.message
});
```

## Timeout
- Switch to async mode
- Notify user

---

# 12. Performance Considerations

- Keep updates < 1KB
- Avoid high-frequency updates
- Batch if necessary

---

# 13. Security

- Validate tenant_id
- Restrict connection ownership
- No sensitive payloads in events

---

# 14. Optional: Realtime DB (InstantDB)

Use only for:
- Debug dashboards
- Internal monitoring

Do NOT use for:
- Core data
- Caching

---

# 15. Benefits

- Improved UX
- Reduced perceived latency
- Clear system visibility
- No token overhead

---

# Final Summary

This architecture enables:
- Realtime execution tracking
- Clean separation from core system
- Scalable AWS-native implementation

Result:
A responsive, enterprise-grade AI UX layer.

