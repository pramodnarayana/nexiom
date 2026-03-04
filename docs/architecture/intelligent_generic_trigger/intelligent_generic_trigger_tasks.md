# Implementation Tasks: Intelligent Generic Trigger Engine

This document breaks down the Phase 1-3 implementation roadmap of the Intelligent Generic Trigger Engine into actionable engineering tasks for assignment.

## Phase 1: Architectural Foundation (The Smart Kernel)

### DB & Schema Management

- [ ] Create `public.connector_optimization_hints` table schema for the Knowledge Registry.
- [ ] Implement database migrations to add this new `connector_optimization_hints` table.

### Core Services Implementation (`packages/engine`)

- [ ] Build the `DiscoveryService` module to fetch, cache, and normalize SaaS schemas.
- [ ] Implement the `OptimizationRegistry` (JSONB Hint Store) module to retrieve and override optimization hints.
- [ ] Create a base `QueryTranslator` module responsible for constructing dynamic queries based on generic filters and paths.
- [ ] Scaffold `universal-trigger.ts` to act as the single execution path runner (replacing all current `new-*.ts` trigger files).

## Phase 2: Salesforce Integration (Weeks 1-4)

*Goal: Support 400+ Salesforce objects (Standard & Custom) using the Smart Kernel.*

### 2.1 Discovery & SOQL Generator

- [ ] Implement the `DescribeSObject` metadata lookup logic inside the Salesforce `DiscoveryService` adapter.
- [ ] Build Smart Cursor Selection logic: Test the object's schema to automatically pick `SystemModstamp` (Highest reliability) > `LastModifiedDate` (Standard) > `CreatedDate` (Append-only) as the polling cursor.
- [ ] Build the dynamic SOQL query generator inside `QueryTranslator` that strictly maps `user input fields` to the `SELECT` clause, avoiding `SELECT *`.

### 2.2 Relationship Auto-Joins

- [ ] Implement logic to detect valid child relationships using the `ChildRelationships` metadata from Salesforce.
- [ ] Update the SOQL generator to automatically build nested sub-queries for auto-joins (e.g., fetching `LineItems` when querying `Invoice`).

### 2.3 High-Volume Handling (Bulk API 2.0)

- [ ] Implement the "Auto-Switch" mechanism: Detect if a standard REST polling query returns a `TotalSize > 5,000`.
- [ ] Implement the Bulk API 2.0 State Machine logic to seamlessly switch to Bulk polling when the high-volume threshold is breached (Job Upload -> Query Status -> Download Results -> End Stream).

## Phase 3: QuickBooks Integration (Weeks 5-7)

*Goal: Master relational data and Change Data Capture (CDC) patterns.*

### 3.1 Relational Enrichment

- [ ] Analyze fragmented QuickBooks entity responses (e.g., Invoices missing deep Customer/Item details).
- [ ] Build the "Just-In-Time" (JIT) relational fetching worker within the Universal Runner to auto-fetch missing linked entity IDs discovered during the initial poll.

### 3.2 CDC Implementation

- [ ] Implement the QuickBooks CDC (Change Data Capture) listener endpoint polling strategy.
- [ ] Implement `changedSince` timestamp and cursor tracking specifically engineered for the CDC `/v3/company/<id>/cdc` endpoint.

## Phase 4: Global Expansion & Rollout (Weeks 8-10)

### Standardization

- [ ] Abstract the custom Salesforce/QuickBooks optimization logic into a reusable generic `Optimization Schema`.
- [ ] Define the exact JSON structures for the `Hint Profiles` so new apps (like HubSpot or NetSuite) can be onboarded via configuration rather than code.

### Quality Assurance & Migration

- [ ] Build a "Shadow Mode" system to run the generic trigger alongside the existing hardcoded triggers, logging any payload parity differences.
- [ ] Migrate the "Top 10" most used objects (e.g., Salesforce Contact, Hubspot Deal) to use the new Intelligent Engine by writing their configuration Hint Profiles.
- [ ] Upon 100% parity verification, execute the "Big Delete": remove all existing `packages/pieces/*/triggers/new-*.ts` files.
- [ ] Update the UI Route Wizard to remove the long list of specific endpoint triggers, replacing them with a single "Smart Sync" unified option.
