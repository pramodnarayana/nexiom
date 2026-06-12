# Soopa Performance & Scalability Layer

## Overview
This document defines key system components required to ensure performance, scalability, and cost control for Soopa's AI platform at enterprise scale (millions of messages).

---

# 1. Caching Strategy

## Purpose
Reduce repeated API calls, minimize latency, and lower token usage.

## Cache Key Design
```
{tenant_id}:{category}:{entity}:{id}:{viewMode}
```

## Cache Layers

### 1. Raw Cache (Connector Layer)
- TTL: 5–15 minutes

### 2. Transformed Cache (Primary)
- TTL: 15–60 minutes

### 3. LLM Response Cache (Optional)
- TTL based on query type

---

## Distributed Cache Design (AWS)

Use **Amazon ElastiCache (AWS managed Redis service)**

- Multi-AZ replication
- Cluster mode enabled
- Sharding for scale

### Architecture
```
App Servers
   ↓
ElastiCache (Redis Cluster)
   ↓
Hot Data Access
```

---

# 2. Rate Limiting & Cost Governance Layer

## Purpose
Control usage and prevent runaway costs.

## Rate Limiting

### Per Tenant
- RPM (Requests per minute)
- TPM (Tokens per minute)

### Implementation
Use Redis counters:
```ts
INCR tenant:{id}:rpm
EXPIRE 60
```

---

## Cost Governance

Track:
- Tokens per request
- Tokens per tenant
- API calls

### Budget Enforcement
```ts
if (monthlyCost > limit) {
  disableAI(tenant_id);
}
```

---

# 3. Async Processing / Job Queue

## Purpose
Handle heavy workloads asynchronously.

## Recommended Technologies

- **Amazon SQS (AWS message queue service)** (queue)
- **Amazon SNS (AWS pub/sub messaging)** (fanout)
- **AWS Lambda (serverless compute)** or workers

---

## Architecture
```
API Layer
  ↓
SQS Queue
  ↓
Worker Fleet (Lambda / ECS)
  ↓
Processing
  ↓
Store Result
```

---

## When to Use Async
- Large datasets
- Cross-category queries
- Batch processing

---

# 4. Schema Versioning

## Purpose
Ensure backward compatibility.

## Strategy

### Versioned APIs
```
/api/v1/...
/api/v2/...
```

### Transformer Versioning
```ts
transform(category, app, raw, version)
```

---

# 5. Queue Technology Comparison

| Feature | BullMQ | Kafka | SQS |
|--------|--------|-------|-----|
| Setup | Simple | Complex | Managed |
| Scale | Medium | Very High | Very High |
| Ordering | Yes | Yes | Limited |
| Use Case | App-level | Event streaming | SaaS async jobs |

**Recommendation:** SQS for Soopa (managed + scalable)

---

# 6. Cost per Feature Breakdown

## Per Query Type

| Query Type | Tokens | Cost Impact |
|-----------|--------|------------|
| Summary | Low (~200) | Low |
| Financial | Medium (~500) | Medium |
| Execution | High (~1000+) | High |
| Cross-category | Very High | Expensive |

---

# 7. AWS Cloud Architecture (Millions of Messages)

## Core Components

- **Amazon API Gateway (AWS API management)** — entry point
- **AWS Lambda (serverless compute)** — lightweight requests
- **Amazon ECS (container orchestration)** — heavy workers
- **Amazon SQS (AWS message queue service)** — async queue
- **Amazon ElastiCache (Redis service)** — caching
- **Amazon DynamoDB (NoSQL database)** — fast storage
- **Amazon S3 (object storage)** — large payload storage

---

## High-Level Architecture

```
Client
  ↓
API Gateway
  ↓
Lambda (Planner + Router)
  ↓
--------------------------
| Fast Path (sync)       |
| → Transformer → LLM    |
--------------------------
| Heavy Path (async)     |
| → SQS → ECS Workers    |
--------------------------
  ↓
Cache (Redis)
  ↓
DB (DynamoDB)
  ↓
Response
```

---

## Scaling Strategy

### Horizontal Scaling
- Lambda auto-scales
- ECS auto-scaling groups

### Queue Buffering
- SQS absorbs spikes

### Caching
- Reduce LLM + API calls by 70–90%

### Storage Strategy
- DynamoDB for metadata
- S3 for large JSON blobs

---

## Multi-Tenant Scaling

- Partition by tenant_id
- Isolated rate limits
- Per-tenant cache keys

---

# Final Summary

This layer ensures:
- High performance via distributed caching
- Controlled costs via governance layer
- Massive scalability via AWS architecture
- Async processing for heavy workloads
- Backward compatibility via schema versioning

Result:
A production-grade system capable of handling millions of AI-driven requests efficiently.