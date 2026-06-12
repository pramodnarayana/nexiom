# Soopa Internal Mapping System Design

## Overview
This document defines the internal system required to scale canonical schema mapping across multiple SaaS applications.

It covers:
- Mapping Schema Standard
- Relation Resolver Design
- Internal Mapping Builder UI (for Soopa team, not customers)

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

### Security Requirements

**CRITICAL:** Computed field expressions MUST be evaluated using a restricted parser or DSL, NEVER via `eval()` or dynamic code execution.

Implementation requirements:
- Use a safe expression evaluator or sandboxed interpreter
- Enforce an allowlist of permitted operators and functions (e.g., +, -, *, /, basic math functions only)
- Disallow arbitrary code execution, function calls, or property access beyond the defined field names
- Implement resource limits: expression evaluation timeouts, recursion depth limits, and complexity caps
- Validate all field references in the expression against the available field set
- Log all compute expression evaluations for audit purposes

Example safe operators allowlist: `+`, `-`, `*`, `/`, `%`, `Math.abs`, `Math.min`, `Math.max`, `Math.round`

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

Used by Soopa team to:
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

This UI is strictly **internal to Soopa engineering and operations teams**.

### Access Control & Governance

**Current Status:** Internal tool only, not accessible to customers or SMB users.

**Future Exposure Criteria:** If this UI is to be exposed to power users in the future, the following requirements must be met:

1. **Target User Groups:**
   - Enterprise customers with dedicated integration teams only
   - Minimum contract tier and support level requirements
   - Users must complete training and certification program

2. **Required Roles & Permissions:**
   - System Administrator role required
   - Additional "Mapping Administrator" permission flag
   - Multi-factor authentication (MFA) mandatory for access
   - Session timeout limits and audit logging

3. **RBAC Boundaries:**
   - Users can only modify mappings scoped to their tenant
   - Cannot access or view global/system mappings
   - Cannot modify mappings for apps not connected to their tenant

4. **Approval Workflow:**
   - All mapping changes require peer review
   - Automated validation against schema contracts
   - Rollback capability for all changes
   - Change notification to Soopa operations team

Until these criteria are implemented and validated, the UI remains permanently internal.

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

### PII & Data Governance Controls

**REQUIRED:** All AI-assisted mapping generation MUST implement the following data protection measures:

#### 1. Data Minimization & Redaction
- **Redact PII/sensitive data** from metadata before sending to LLM
- Use pseudonymization for field names containing identifiable information
- Send **schema-only inputs** (field names, types, relationships) without actual data values
- Remove any sample data values before constructing prompts
- Strip connection credentials, API keys, and tenant-specific identifiers

Example redacted prompt input:
```json
{
  "sourceFields": ["field_1", "field_2", "field_3"],
  "targetSchema": ["canonicalField1", "canonicalField2"],
  "fieldTypes": {"field_1": "string", "field_2": "number"}
}
```

#### 2. Retention Limits & TTL
- Store prompts and LLM responses for **maximum 90 days**
- Implement automated deletion policy for prompt/response artifacts
- Provide manual purge capability for immediate deletion on request
- Log deletion events for compliance audit trail

#### 3. Auditability & Provenance
Store the following metadata for every AI-generated mapping:
- Timestamp of generation
- User ID who initiated the request
- Prompt hash (SHA-256) for reproducibility verification
- Model ID and version (e.g., "gpt-4-2024-01", "gemini-1.5-pro")
- Mapping change records (before/after diff)
- Approval status and reviewer ID

Example audit log entry:
```json
{
  "event": "ai_mapping_generated",
  "timestamp": "2024-01-15T10:30:00Z",
  "userId": "user_abc123",
  "promptHash": "sha256:a1b2c3...",
  "modelId": "gpt-4-2024-01",
  "mappingId": "mapping_xyz789",
  "changes": {...},
  "status": "pending_review"
}
```

#### 4. Access Controls & Consent
- Require explicit user consent before sending metadata to external LLM
- Implement approval step for AI-generated mappings before production use
- Log all AI mapping requests for security monitoring
- Provide transparency report showing what data was sent to LLM

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
A powerful internal data abstraction layer that powers Soopa's AI platform.
