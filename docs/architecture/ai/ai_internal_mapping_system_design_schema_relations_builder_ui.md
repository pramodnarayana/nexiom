# Nexiom Internal Mapping System Design

## Overview
This document defines the internal system required to scale canonical schema mapping across multiple SaaS applications.

It covers:
- Mapping Schema Standard
- Relation Resolver Design
- Internal Mapping Builder UI (for Nexiom team, not customers)

This system is **NOT exposed to SMB users**. It powers the zero-config experience.

---

# 1. Design Goals

- Support 100s of objects per app
- Handle nested + relational data
- Enable auto-mapping
- Avoid hardcoded transformations
- Keep AI runtime clean and minimal

---

# 2. Mapping Schema Standard

## 2.1 Purpose

Define how raw app fields map to canonical fields.

---

## 2.2 Basic Structure

```json
{
  "entity": "Load",
  "category": "TMS",
  "view": "summary",
  "fields": {
    "number": "rtms__Load__c.Name",
    "status": "rtms__Load__c.rtms__Load_Status__c",
    "origin": "rtms__Load__c.rtms__Origin__c",
    "destination": "rtms__Load__c.rtms__Destination__c"
  }
}
```

---

## 2.3 Nested Fields

```json
{
  "route": {
    "origin": "rtms__Load__c.rtms__Origin__c",
    "destination": "rtms__Load__c.rtms__Destination__c"
  }
}
```

---

## 2.4 Arrays / Collections

```json
{
  "stops": {
    "type": "array",
    "source": "relations.rtms__Stop__c.records",
    "mapping": {
      "sequence": "rtms__Stop_Number__c",
      "location": "rtms__Location__c"
    }
  }
}
```

---

## 2.5 Conditional Mapping

```json
{
  "status": {
    "source": "rtms__Load_Status__c",
    "transform": {
      "Delivered": "completed",
      "In Transit": "in_progress"
    }
  }
}
```

---

## 2.6 Computed Fields

```json
{
  "margin": {
    "compute": "customer_total - carrier_total"
  }
}
```

---

# 3. Transformer Engine Requirements

The engine must support:
- Deep path resolution
- Nested object creation
- Array mapping
- Conditional transforms
- Computed fields

---

# 4. Relation Resolver Design

## 4.1 Purpose

Handle relationships between entities.

Example:
```
Load
  ├── Stops
  ├── LineItems
  ├── Invoices
```

---

## 4.2 Relation Definition

```json
{
  "entity": "Load",
  "relations": {
    "stops": {
      "source": "rtms__Stop__c",
      "type": "1:N"
    },
    "line_items": {
      "source": "rtms__LineItem__c",
      "type": "1:N"
    }
  }
}
```

---

## 4.3 Resolver Flow

```text
Raw Data
  ↓
Detect relations
  ↓
Extract related records
  ↓
Apply child mappings
  ↓
Attach to parent
```

---

## 4.4 Example Output

```json
{
  "number": "215236",
  "stops": [
    { "sequence": 1, "location": "Chicago" }
  ]
}
```

---

## 4.5 Lazy Loading (important)

Only resolve relations when needed:
- summary → no relations
- execution → include stops

---

# 5. Mapping Builder UI (Internal Tool)

## 5.1 Purpose

Used by Nexiom team to:
- Create mappings
- Debug transformations
- Onboard new apps

---

## 5.2 Key Features

### 1. Schema Explorer
- Show app objects
- Show fields
- Show relationships

---

### 2. Drag-and-Drop Mapping

```text
[Source Field] → [Canonical Field]
```

---

### 3. Preview Panel

- Input: raw JSON
- Output: transformed JSON

---

### 4. Relation Mapping UI

- Define parent-child relationships
- Map nested structures

---

### 5. Versioning

- Save versions
- Compare mappings

---

## 5.3 NOT exposed to SMB users

This UI is:
- Internal
- Possibly for power users later

---

# 6. Auto-Mapping Strategy

## Step 1 — Metadata Extraction

From pieces layer:
- Objects
- Fields
- Relationships

---

## Step 2 — Heuristic Matching

Examples:
- Name → number
- Status → status

---

## Step 3 — AI-Assisted Mapping

Use LLM once:
- Suggest mappings
- Store results

---

## Step 4 — Human Review (internal)

---

# 7. Storage Strategy

Mappings stored in:
- Files (initial)
- Database (later)

Structure:

```
mappings/
  salesforce/
    tms/load.json
```

---

# 8. Versioning Strategy

```
load.v1.json
load.v2.json
```

- Maintain backward compatibility

---

# 9. Execution Flow

```text
Raw Data
  ↓
Load Mapping
  ↓
Transform
  ↓
Resolve Relations
  ↓
Return Canonical
```

---

# 10. Design Principles Summary

## DO
- Use config-driven mapping
- Keep schemas minimal
- Separate mapping from runtime
- Resolve relations selectively

## DO NOT
- Expose mapping to users
- Hardcode field paths
- Mirror full source schemas

---

# Final Summary

This system enables:
- Scalable transformation across apps
- Clean separation of concerns
- Zero-config experience for users

Result:
A powerful internal data abstraction layer that powers Nexiom's AI platform.

