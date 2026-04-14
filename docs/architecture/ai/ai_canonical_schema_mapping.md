# Nexiom Scalable Canonical Schema & Mapping Strategy

## Overview
This document defines a scalable strategy for building and maintaining canonical schemas and mappings across multiple SaaS applications (Salesforce, QuickBooks, etc.).

The goal is to support:
- 100s of objects per app
- Multiple domains (TMS, Accounting, CRM, etc.)
- Minimal LLM token usage
- Rapid onboarding of new apps

---

# 1. Core Problem

Each application:
- Has hundreds of objects
- Uses different naming conventions
- Has deeply nested structures

A naive approach (hardcoded transformers) will not scale.

---

# 2. Design Principles

## 2.1 Canonical ≠ Mirror Schema

Canonical schemas must:
- Be minimal
- Be business-driven
- NOT replicate source systems

---

## 2.2 Config-Driven Mapping (not code)

Avoid hardcoding transformations.

Use mapping configs instead.

---

## 2.3 Category-Based Abstraction

Group objects by domain:
- TMS
- Accounting
- CRM

---

## 2.4 Separation of Layers

```
Raw Data (App)
   ↓
Mapping Layer
   ↓
Canonical Schema
   ↓
AI Engine
```

---

# 3. Architecture

## Directory Structure

```
packages/
  ├── canonical/
  │     ├── tms/
  │     ├── accounting/
  │     ├── crm/
  │
  ├── mappings/
  │     ├── salesforce/
  │     │     ├── tms/
  │     │     ├── crm/
  │     │
  │     ├── quickbooks/
  │
  ├── transformer-engine/
```

---

# 4. Canonical Schema Design

## Example: TMS Load

```ts
type Load = {
  number: string;
  status: string;
  origin: string;
  destination: string;
  weight?: number;
  financials?: {
    customer_total?: number;
    carrier_total?: number;
  };
};
```

---

## Key Rules

- Limit fields to business-critical data
- Avoid deep nesting unless required
- Keep schemas stable

---

# 5. Mapping Layer

## Example Mapping

```json
{
  "number": "rtms__Load__c.Name",
  "status": "rtms__Load__c.rtms__Load_Status__c",
  "origin": "rtms__Load__c.rtms__Origin__c",
  "destination": "rtms__Load__c.rtms__Destination__c"
}
```

---

## Mapping Characteristics

- Stored as JSON (or DB)
- App-specific
- Category-aware
- Versioned

---

# 6. Transformer Engine

## Generic Transformer

```ts
function transform(raw, mapping) {
  const output = {};

  for (const key in mapping) {
    output[key] = get(raw, mapping[key]);
  }

  return output;
}
```

---

# 7. Handling Relations

## Example

```
Load
  ├── Stops
  ├── Line Items
```

Each relation:
- Has its own schema
- Has its own mapping

---

# 8. View Modes (Critical for Scale)

Define multiple representations:

- summary
- financial
- execution

Each uses different mappings.

---

# 9. Metadata-Driven Mapping

## Source
- Salesforce describe API
- QuickBooks schema

## Use
- Auto-suggest mappings
- Validate field existence

---

# 10. AI-Assisted Mapping (Setup Only)

Use AI during onboarding:

Input:
- Raw schema

Output:
- Suggested mapping

Store result permanently.

---

# 11. Versioning Strategy

```
load.v1.json
load.v2.json
```

- Never break existing mappings
- Support gradual upgrades

---

# 12. Tenant-Specific Mapping

Support overrides:

```
mappings/
  tenant_123/
    salesforce/tms/load.json
```

---

# 13. Fallback Strategy

If mapping missing:

```ts
return {
  number: raw.Name,
  preview: pickTopFields(raw)
};
```

---

# 14. Scaling Strategy Summary

## DO
- Use config-driven mappings
- Keep canonical minimal
- Build generic transformer
- Use categories + view modes

## DO NOT
- Hardcode transformations
- Mirror full schemas
- Couple mappings with AI runtime

---

# 15. Benefits

- Add new apps quickly
- Support 100s of objects
- Enable cross-app analytics
- Reduce token usage

---

# Final Summary

This system transforms:

```
Complex app schemas
      ↓
Mapping configs
      ↓
Simple canonical schemas
      ↓
AI-ready data
```

Result:
A scalable, maintainable, and extensible canonical data layer for Nexiom.

