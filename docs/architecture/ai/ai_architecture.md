# Nexiom AI Data Architecture

## Overview
This document defines the architecture for building a scalable, token-efficient AI layer for Nexiom across multiple SaaS apps (Salesforce/Revenova, QuickBooks, etc.). The system enforces:

- Category-based abstraction (TMS, Accounting, CRM)
- Generic transformation before LLM
- Query planning to minimize data fetch
- Strict token and payload control

---

# 1. Core Principles

## 1.1 Separation of Concerns
- Connectors (fetch)
- Category Transformers (shape)
- Query Planner (decide)
- LLM (reason)

## 1.2 Never Send Raw Data to LLM
Always transform to canonical schema.

## 1.3 Category-Based Abstraction
Domains:
- TMS
- Accounting
- CRM / Marketing

---

# 2. High-Level Architecture

```
User Query
    ↓
Query Planner
    ↓
Tool Selection
    ↓
Connector (App)
    ↓
Category Transformer
    ↓
Canonical Schema
    ↓
LLM
```

---

# 3. Category-Based Transformation Layer

## Purpose
Convert app-specific data into minimal, standardized business objects.

## Key Idea
Different apps → Same category → Same schema

---

# 4. Canonical Schemas (Full Set)

## 4.1 TMS — Load
```ts
type TMS_Load = {
  entity: "load";
  id: string;
  number: string;
  status: string;
  route: { origin: string; destination: string };
  shipment?: { commodity?: string; weight?: number; units?: string };
  stops?: { count: number };
  financials?: {
    customer_total?: number;
    carrier_total?: number;
    margin?: number;
    invoice_status?: string;
  };
};
```

## 4.2 TMS — Stop
```ts
type TMS_Stop = {
  entity: "stop";
  id: string;
  sequence: number;
  type: "pickup" | "delivery";
  location: string;
  date?: string;
  status?: string;
};
```

## 4.3 Accounting — Invoice
```ts
type Accounting_Invoice = {
  entity: "invoice";
  id: string;
  number: string;
  status: string;
  amounts: { total: number; paid?: number; balance?: number };
  parties?: { customer?: string; vendor?: string };
  dates?: { issue_date?: string; due_date?: string };
};
```

## 4.4 Accounting — Payment
```ts
type Accounting_Payment = {
  entity: "payment";
  id: string;
  amount: number;
  date: string;
  method?: string;
  linked_invoice?: string;
};
```

## 4.5 CRM — Customer
```ts
type CRM_Customer = {
  entity: "customer";
  id: string;
  name: string;
  email?: string;
  company?: string;
};
```

---

# 5. Category Transformers

Example: Salesforce → TMS Load

```ts
function mapSalesforceToTMS(raw: any): TMS_Load {
  const l = raw.rtms__Load__c;
  const rel = raw.relations || {};

  return {
    entity: "load",
    id: l.Id,
    number: l.Name,
    status: l.rtms__Load_Status__c,
    route: {
      origin: l.rtms__Origin__c,
      destination: l.rtms__Destination__c,
    },
    shipment: {
      commodity: rel["rtms__LineItem__c|1:N"]?.records?.[0]?.rtms__Item_Description__c,
      weight: l.rtms__Total_Weight__c,
      units: l.rtms__Weight_Units__c,
    },
    stops: {
      count: rel["rtms__Stop__c|1:N"]?.records?.length || 0,
    },
    financials: {
      customer_total: l.rtms__Customer_Quote_Total__c,
      carrier_total: l.rtms__Carrier_Invoice_Total__c,
      margin: l.rtms__Margin_Quoted__c,
      invoice_status: rel["rtms__CarrierInvoice__c|1:N"]?.records?.[0]?.rtms__Invoice_Status__c,
    },
  };
}
```

---

# 6. Transformer Registry

```ts
const categoryTransformers = {
  TMS: { salesforce: mapSalesforceToTMS },
  Accounting: { quickbooks: mapQuickbooksToAccounting },
};
```

---

# 7. Query Planner

## Purpose
Determine category, intent, tool, and view mode.

## Example
```ts
function planTMS(query: string) {
  const q = query.toLowerCase();
  const id = q.match(/\b\d{5,}\b/)?.[0];

  if (q.includes("invoice") || q.includes("margin")) {
    return { intent: "financial", tool: "getLoadFinancials", params: { id } };
  }

  if (q.includes("stop") || q.includes("tracking")) {
    return { intent: "execution", tool: "getLoadExecution", params: { id } };
  }

  return { intent: "summary", tool: "getLoadSummary", params: { id } };
}
```

---

# 8. Sequence Diagrams

## 8.1 Standard Flow
```
User → Planner → Tool → Connector → Transformer → LLM → Response
```

## 8.2 Detailed Flow
```
User Query
  ↓
Query Planner (detect category + intent)
  ↓
Select Tool (minimal)
  ↓
Connector fetches raw data
  ↓
Category Transformer reduces + normalizes
  ↓
LLM receives small payload
  ↓
Response generated
```

---

# 9. API Contract Layer

## Purpose
Expose consistent APIs to UI / clients.

## Example API

### GET Load Summary
```
GET /api/tms/load/{id}/summary
```

Response:
```json
{
  "number": "215236",
  "status": "Delivered",
  "origin": "Salem",
  "destination": "Iuka"
}
```

### GET Financials
```
GET /api/tms/load/{id}/financials
```

---

# 10. Cross-Category Reasoning Engine

## Purpose
Enable reasoning across domains.

## Example
Query:
"Compare load margin vs invoice payment"

## Flow
```
Planner → Detect multi-category (TMS + Accounting)
  ↓
Fetch TMS Load
Fetch Accounting Invoice
  ↓
Transform both to canonical schemas
  ↓
Merge context
  ↓
LLM reasoning
```

## Output Example
- Margin: $500
- Invoice Paid: $300
- Gap: $200

---

# 11. Error Handling & Fallback

## 11.1 Tool Failure
- Retry once
- Return partial data if possible

## 11.2 Payload Too Large
```ts
if (JSON.stringify(data).length > 2000) {
  return { error: "Payload reduced" };
}
```

## 11.3 Missing Data
- Return available fields
- Add "unknown" instead of failing

## 11.4 LLM Failure
- Fallback to direct formatted response

---

# 12. Token Optimization

| Scenario | Before | After |
|--------|--------|------|
| Single load | 5000 tokens | 200 tokens |
| Batch | 50K | 2K |

---

# 13. Observability

```ts
console.log({
  raw_size: JSON.stringify(raw).length,
  transformed_size: JSON.stringify(transformed).length,
});
```

---

# 14. Data Lineage Tracking

## Purpose
Provide full traceability from raw source data to final AI response.

## Flow
```
Raw Data (Connector)
  ↓
Transformed Data (Category Transformer)
  ↓
LLM Input
  ↓
LLM Output
```

## Implementation

```ts
const lineage = {
  trace_id: uuid(),
  raw_size: JSON.stringify(raw).length,
  transformed_size: JSON.stringify(transformed).length,
  tool: plan.tool,
  category: plan.category,
  timestamp: new Date().toISOString(),
};

logLineage(lineage);
```

## Benefits
- Debugging
- Auditing
- Cost tracking
- Performance optimization

---

# 15. Caching Strategy

## Purpose
Reduce repeated API calls and token usage.

## Cache Keys
```
{category}:{entity}:{id}:{viewMode}
```

Example:
```
TMS:Load:215236:summary
```

## Cache Layers

### 1. Raw Cache (Connector Level)
- Cache raw API responses
- TTL: short (e.g., 5–15 mins)

### 2. Transformed Cache (Recommended)
- Cache canonical output
- TTL: medium (e.g., 15–60 mins)

### 3. LLM Response Cache (Optional)
- Cache final responses
- Useful for repeated queries

## Example
```ts
const cacheKey = `${category}:${entity}:${id}:${viewMode}`;

if (cache.exists(cacheKey)) {
  return cache.get(cacheKey);
}

const result = transform(...);
cache.set(cacheKey, result);
```

---

# 16. Multi-Tenant Isolation Design

## Purpose
Ensure strict data isolation across customers.

## Key Principles

### 1. Tenant-Aware Context
Every request must include:
```ts
{
  tenant_id: string;
}
```

### 2. Isolation at All Layers

#### Connector Layer
- Separate credentials per tenant

#### Cache Layer
```
{tenant_id}:{category}:{entity}:{id}:{viewMode}
```

#### Transformation Layer
- No shared state

#### LLM Context
- Never mix tenant data

---

## Example
```ts
const cacheKey = `${tenantId}:${category}:${entity}:${id}:${viewMode}`;
```

---

## Security Measures

- Row-level isolation
- Encrypted credentials
- Per-tenant API limits
- Audit logs per tenant

---

# 17. Final Summary

This system provides:
- Category-based abstraction
- Generic transformation layer
- Query planner
- Cross-category reasoning
- API contract layer
- Data lineage tracking
- Caching strategy
- Multi-tenant isolation

Result:
A scalable, efficient, domain-aware, enterprise-grade AI platform.

