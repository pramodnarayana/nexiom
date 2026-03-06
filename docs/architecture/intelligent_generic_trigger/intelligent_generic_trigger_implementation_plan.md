# Implementation Plan: Intelligent Generic Trigger Engine

This document outlines the phased engineering roadmap to transition FluxNex from hardcoded triggers to a 100% Intelligent Metadata-Driven Engine, starting with Salesforce and QuickBooks.

## 1. Architectural Foundation (The Smart Kernel)

Before building app-specific logic, we must implement the Intelligence Registry in `packages/engine`.

- **Metadata Service:** A service that fetches and caches SaaS schemas (fields, types, relationships).
- **Optimization Registry:** A JSONB store for "Object Hints" (e.g., `Account` -> use: `SystemModstamp`).
- **Unified Runner:** A single trigger implementation that replaces all `new-*.ts` files.

## Phase 1: Salesforce (Weeks 1-4)

**Goal:** Support 400+ Salesforce objects (Standard & Custom) with a single intelligent trigger.

### 1.1 Discovery & SOQL Generator

- Implement `DescribeSObject` lookup to identify all available fields for the selected object.
- **Smart Cursor Selection:** Logic to automatically pick the best field for polling:
  - `SystemModstamp` (Highest reliability)
  - `LastModifiedDate` (Standard)
  - `CreatedDate` (Append-only)
- **SOQL Builder:** Dynamically generate queries based on user mappings to avoid `SELECT *` and save API bandwidth.

### 1.2 High-Volume Handling (Bulk API 2.0)

- Implement an "Auto-Switch" mechanism: If the polling query returns a `TotalSize > 5,000`, the engine cancels standard polling and initiates a Salesforce Bulk API 2.0 Job.
- Handle the state machine for Bulk Jobs (Upload -> Query Status -> Download Results).

### 1.3 Relationship Auto-Joins

- Detect child relationships (e.g., `LineItems` for an `Invoice`).
- Generate nested SOQL sub-queries: `SELECT Id, (SELECT Price, Qty FROM LineItems) FROM Invoice`.

## Phase 2: QuickBooks (Weeks 5-7)

**Goal:** Master relational data and Change Data Capture (CDC) patterns.

### 2.1 Relational Enrichment

- QuickBooks data is often fragmented. When a user maps an `Invoice`, the engine must automatically identify that it needs to fetch the linked `Customer` and `Item` details to provide a "Helpful" JSON to the AI and Mapping layer.
- Implement JIT fetching for missing relational IDs discovered during polling.

### 2.2 CDC Implementation

- Implement the QuickBooks-specific CDC (Change Data Capture) endpoint.
- **Logic:** `GET /v3/company/<id>/cdc?entities=Invoice,Customer,Payment&changedSince=<timestamp>`.
- This reduces the number of API calls significantly compared to polling each object individually.

## Phase 3: Global Expansion (Weeks 8-10)

**Goal:** Standardize the framework for all other connections (HubSpot, NetSuite, etc.).

### 3.1 Generic Hint Abstraction

- Extract the "Salesforce Hacks" and "QuickBooks Patterns" into a generic Optimization Schema.
- Allow developers to add support for a new app just by defining its Hint Profile:

```json
{
  "app": "hubspot",
  "polling_strategy": "SEARCH_API",
  "cursor_field": "hs_lastmodifieddate",
  "batch_size": 100
}
```

### 3.2 Cleanup & Migration

- **Parity Testing:** Run the Intelligent Trigger in "Shadow Mode" alongside the old hardcoded triggers for 1 week.
- **The Big Delete:** Once data parity is confirmed, delete the `packages/pieces/*/triggers/new-*.ts` files.
- **UI Update:** Update the Route Wizard to remove the long list of specific triggers and replace them with a single "Smart Sync" option.

## 4. Key Success Metrics

| Metric | Target |
| --- | --- |
| Maintenance | Reduce integration code files by 80%. |
| API Efficiency | Reduce unnecessary field fetching by 40% via dynamic SOQL. |
| Onboarding | Support custom objects (`__c`) with zero developer intervention. |
| AI Quality | AI responses include relational context (Joins) in 100% of tool calls. |

## 5. Summary for Developers

Building this engine turns our platform into a Metadata-Aware System. Instead of writing code for "what" to sync, we are writing a kernel that understands "how" to discover what the user wants and executes the most efficient API path automatically.
