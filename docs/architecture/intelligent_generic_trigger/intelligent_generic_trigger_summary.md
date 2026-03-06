# Intelligent Generic Trigger Engine: Summary

This document consolidates the strategy, architecture details, and implementation plan for the Intelligent Generic Trigger Engine based on the core architecture specifications.

## 1. Problem Statement & Strategy

The current architecture relies on hardcoded trigger files (e.g., `new-contact.ts`) for every object across SaaS platforms. For expansive systems like Salesforce with 400+ custom and standard objects, this creates an unmanageable "Technical Debt Trap"—requiring hundreds of files to be updated whenever an API changes.

A naive "dumb" generic trigger solves the file bloat but fails enterprise constraints because it treats all objects identically, leading to API rate-limit exhaustion and missing relational child records.

**The Solution:** Transition to a **100% Intelligent Generic Trigger**. This engine behaves like custom-coded triggers by dynamically reading "Metadata Hints" to figure out the most optimized polling strategy, correct relational joins, and optimal API endpoints dynamically at runtime.

## 2. Architecture Details

The architecture shifts the platform from specialized "scripts" to a metadata-aware "Runtime Kernel". It consists of the following technical pillars:

### The Metadata Hint Registry (The Brain)

A database table (`public.connector_optimization_hints`) that stores strategy overrides for specific objects. For example, it tells the engine that a Salesforce "Invoice" should auto-join "LineItems" and "Account", use `SystemModstamp` as the cursor, and prefer Bulk API ingestion if limits are exceeded.

### The Universal Runner (`universal-trigger.ts`)

A single execution engine replacing the hundreds of `new-*.ts` files. Its lifecycle includes:

- **Context Hydration:** Dynamically fetches the object's live schema and corresponding optimization hints from the registry.
- **Smart Query Building:** Dynamically generates queries (like SOQL/SQL) strictly for mapped fields, injects necessary sub-queries for auto-joins, and filters by the most reliable high-water mark cursor.
- **Execution Path Selection:** Automatically routes the execution to standard REST calls for small batches, Change Data Capture (CDC) streams if supported, or the high-volume Bulk API 2.0 state machine for massive data loads.

### Core Supporting Services

- **DiscoveryService:** Caches and normalizes SaaS metadata into standard formats.
- **QueryTranslator:** Converts app-agnostic logic into platform-specific syntax (SOQL, GraphQL).
- **StreamProcessor:** Pipes massive NDJSON/CSV API responses directly into the gateway, avoiding memory exhaustion.

## 3. Implementation Plan

The transition is structured across three phases (10 weeks) to iteratively build the engine while minimizing regression risks:

### Phase 1: Salesforce (Weeks 1-4)

Focuses on creating the architectural foundation.

- Implement schema discovery to select the best cursor (`SystemModstamp` > `LastModifiedDate`) and generate dynamic SOQL queries based on mappings.
- Implement an Auto-Switch Bulk API 2.0 state-machine to handle trigger runs exceeding 5,000 records.
- Build the recursive auto-joins for nested object queries (e.g., fetching `LineItems` alongside `Invoice` in one call).

### Phase 2: QuickBooks (Weeks 5-7)

Focuses on CDC and relational graph fetching.

- Implement Just-In-Time (JIT) relational fetching for fragmented API responses to enrich JSON payloads for the AI mapping layers.
- Implement the QuickBooks CDC (Change Data Capture) endpoint to drastically reduce standard polling limits and API calls.

### Phase 3: Global Expansion (Weeks 8-10)

Focuses on standardization and migration.

- Abstract the optimizations built for Salesforce/QuickBooks into a unified JSON Hint profile (`Optimization Schema`) that any developer can use to add smart support for HubSpot, NetSuite, etc.
- **Migration:** Run the new engine in "Shadow Mode" against the old code for parity testing.
- Upon success, conduct the "Big Delete" of all the hardcoded `packages/pieces/*/triggers/new-*.ts` files and update the UI Route Wizard to a single "Smart Sync" option.

## 4. Key Success Metrics

- **Maintenance:** 80% reduction in integration code files.
- **API Efficiency:** 40% reduction in unnecessary API calls and field fetching.
- **Onboarding:** Support custom objects instantly with zero developer intervention.
- **AI Quality:** 100% of AI responses include full relational context (auto-joins).
