# End-to-End Trace: Multi-Workspace Regional Fan-Out

This document traces the complete lifecycle of a complex enterprise integration—from workspace provisioning to live data execution across international borders.

---

## Scenario: Global Logistics Fan-Out

- **Customer:** Envoy Global Logistics
- **Goal:** Sync Invoices from a single Salesforce Master instance to two regional accounts: QuickBooks US and QuickBooks Canada.
- **Logic:** Invoices with `Region == 'US'` go to the US account; `Region == 'CA'` go to Canada.

---

## Phase 1: Workspace & Inventory Setup

### 1. Workspace Provisioning

The Admin logs into fluxnex.com and creates two isolated logical environments:

- **Logistics-US Workspace:** Assigned to the US Finance team. System provisions physical schema `ws_us_101`.
- **Logistics-CA Workspace:** Assigned to the Canada Finance team. System provisions physical schema `ws_ca_102`.

### 2. Connection Assignment (Scoping)

The Admin authenticates the apps globally and then "invites" them to specific workspaces:

- **Salesforce Master:** Assigned to both Logistics-US and Logistics-CA.
- **QuickBooks US:** Assigned only to Logistics-US.
- **QuickBooks Canada:** Assigned only to Logistics-CA.

> **Security Result:** The Canada team can see Salesforce data but physically cannot access the US QuickBooks credentials or logs.

---

## Phase 2: Configuration & Intelligence

### 3. Route Creation

A user enters the Logistics-US Workspace and clicks **"New Route"**.

- **Source:** User selects the "Salesforce Master" card.
- **Target:** User selects "QuickBooks US".

### 4. Dynamic Object Discovery

The moment Salesforce is selected, the Metadata Discovery Service triggers:

1. FluxNex calls the Salesforce `describe` API.
2. The UI populates a dropdown with all available objects (Standard & Custom).
3. **Action:** The user selects `rtms__Load__c` (Revenova Load).

### 5. Unified Mapping Canvas

The UI renders the mapping table. Because of Discovery, the left column shows the real-time fields for that specific Salesforce instance (including custom fields like `Total_Weight__c`).

- **Mapping Rule:** The user maps `rtms__Total_Amount__c` → `TotalAmt`.
- **Sync Condition:** The user adds a filter: `IF Region == 'US'`.
- **Storage:** This logic is saved as a JSON metadata bundle in the workspace.

---

## Phase 3: The Execution Journey (6-Layer Pipeline)

### Layer 1: Source Gateway (Ingestion)

- **Event:** A webhook from Salesforce arrives containing Invoice #999 with `Region: "CA"`.
- **Physical Action:** The engine checks the Registry, sees the connection belongs to `ws_sf_master`, and saves the raw JSON to `ws_sf_master.inbound_gateway`.
- **Trace ID:** `trc_fanout_abc123` is generated.

### Layer 2: Universal Replica (State Management)

- **Action:** The worker parses the JSON and upserts the `replica_entity` in the Shared Source Schema (`ws_sf_master`).

### Layer 3: Normalization (Standardization)

- **Action:** The worker converts the record into the Canonical Model (`TMS_INVOICE`).

### Layer 4: Outbound Prep (The Fan-Out Decision)

The engine evaluates active routes across all workspaces for this organization.

- **Check Route 1 (US):** Rule is `IF Region == 'US'`. **Outcome: Skip** (Region is CA).
- **Check Route 2 (CA):** Rule is `IF Region == 'CA'`. **Outcome: Match**.
- **Hydration:** The engine pulls the Canada-specific mapping and prepares the QuickBooks payload.

### Layer 5: Delivery Engine (Execution)

- **Action:** The engine acquires the Redis Refresh Lock for the QuickBooks Canada connection.
- **Execution:** It executes the API call using the Canadian OAuth token.

### Layer 6: Destination Gateway (The Closer)

- **Result:** QuickBooks Canada returns `201 Created`.
- **Logging:** The engine switches context to the Target Silo and logs the success in `ws_qb_ca_prod.outbound_gateway`.

---

## Summary of Physical Isolation Points

| Layer | US Context | Canada Context |
| --- | --- | --- |
| UI Workspace | Logistics-US | Logistics-CA |
| Object Type | Account (Discovered) | `rtms__Load__c` (Discovered) |
| Mapping | `US_Template.json` | `CA_Template.json` |
| Database Silo | `ws_us_101` (Schema) | `ws_ca_102` (Schema) |
| Credentials | US-Production-Key | CA-Production-Key |

---

## Enterprise iPaaS Master Specification

### 1. Executive Summary

FluxNex is a high-scale, multi-tenant B2B Integration Platform (iPaaS) designed for high-compliance industries (Logistics, Finance, Healthcare). It distinguishes itself through **Physical Data Siloing**, a **6-Layer Deterministic Pipeline**, and **AI-Assisted Metadata Discovery**.

### 2. The Dual-Track Operational Model

FluxNex operates two distinct lifecycles to ensure platform stability and customer agility.

#### Track 1: Platform SDLC (The Tech Team)

Used by FluxNex engineers to build the core engine and new "App Pieces."

- **Local** (`localhost`): Developer emulator using Docker, LocalStack (KMS/SQS), and Prism (API Mocks).
- **Validation** (`test.fluxnex.com`): Internal staging area. Verified code is merged here for end-to-end regression testing against vendor sandboxes.
- **Release** (`fluxnex.com`): The stable production platform.

#### Track 2: Integration Lifecycle (The Customer/Support)

Used by customers and support agents to sync business data. This happens entirely on the production URL.

- **Sandbox Workspace:** A logical area for testing mappings using developer/test accounts. Physically routed to RDS Standard clusters.
- **Production Workspace:** The live environment for business records. Physically routed to Aurora High-Availability clusters.

### 3. Product Taxonomy & Logical Model

| Concept | Definition | Physical Reality |
| --- | --- | --- |
| Organization | The legal/billing entity (e.g., Envoy Logistics). | A row in the `public.organization` table. |
| Connection | An authenticated instance of an app (e.g., "Salesforce - US"). | Credential in `public.app_connection`; data-plane tables in a dedicated schema identified by `dataNamespace`. |
| Workspace | A logical folder used to group related integrations and team access. | A row in `public.ui_workspace`; acts as a metadata filter. |
| Route | A defined data path between a Source and Destination. | Metadata in `public.integration_route`. |
| Mapping | The field-level logic for a specific route. | Rows in `public.field_mapping` — stored in the control-plane public schema, not in per-connection tenant schemas. |

### 4. Physical Data Architecture (Storage Registry)

FluxNex utilizes the **Infrastructure Router** pattern to ensure physical data isolation.

- **Public Schema (Control Plane):** Global registry for identity, routing rules, field mappings, and the Storage Registry. All control-plane tables (including `public.field_mapping`) live here and are queried without a `search_path` switch.
- **Storage Registry (`public.connection_storage_registry`):** Maps every `connection_id` to a specific `database_host_id` (Server) and `dataNamespace` (logical namespace — the Postgres schema name provisioned for that connection, e.g. `ws_salesforce_a1b2c3`).
- **Data Namespace (The Silo):** Every connection gets its own dedicated Postgres schema, identified by `dataNamespace`.
  - **Isolation:** Workers switch into the correct silo using `SET LOCAL search_path TO {dataNamespace}` scoped to the transaction — the session search_path is never permanently changed.
  - **Search:** JSONB data is protected by GIN Indexes for sub-100ms lookups across custom fields.
  - **Residency:** Connections can be pinned to specific AWS regions (e.g., Frankfurt) via the `regionContext` column in the registry.

### 5. The 6-Layer Sync Engine (SEDA Architecture)

Data moves through six deterministic stages, providing an immutable "flight recorder" for every record.

| Layer | Name | Responsibility |
| --- | --- | --- |
| L1 | Source Gateway | Ingests raw JSON (Webhook or Polling). Persistent log of "Source Evidence." |
| L2 | Universal Replica | Parses raw JSON into a structured state store. Handles deduplication and versioning. |
| L3 | Normalization | Converts source data into the FluxNex Canonical Model (e.g., `TMS_INVOICE`). Handles relational enrichment. |
| L4 | Transformation | Evaluates Sync Conditions (Filters) and hydrates the destination JSON template using the user's mapping rules. |
| L5 | Delivery Engine | Authenticates with the target API (using Redis Refresh Locks) and executes the transaction. |
| L6 | Destination Gateway | Logs the final API response and updates the Global Entity Map (GEM) to link Source and Destination IDs. |

### 6. Intelligence & The Generic Trigger Engine

FluxNex replaces brittle, hardcoded scripts with a metadata-driven kernel.

- **Intelligent Generic Triggers:** A single runner that uses the Adapter Pattern to discover schemas, detect high volume (switching to Bulk API 2.0), and auto-join related data.
- **Model Context Protocol (MCP):** FluxNex acts as a dynamic MCP server. It filters available AI tools based on a tenant's active connections, keeping AI token costs low and accuracy high.
- **AI-Assisted Mapping:** Mappings are created specifically for each environment. The AI analyzes Sandbox mappings and proposes Production mappings, accounting for schema drift between test and live accounts.

### 7. End-to-End "Ground-to-Cloud" Walkthrough

#### Step 1: Acquisition (The Marketplace)

The user finds "Salesforce" in the Marketplace and clicks **"+ New Connection"**.

1. User selects **Environment: Production** in the dropdown.
2. `dbmanager` provisions a schema on the Aurora Prod Cluster.
3. The Registry links the connection to this new physical vault.

#### Step 2: Logical Scoping (The Workspace)

The user creates a Workspace called "Finance Division" and assigns the Salesforce connection to it. Only the Finance team can now "see" this data source.

#### Step 3: Design (The Mapping Canvas)

The user creates a Route.

1. **Discovery:** The system calls the Salesforce API to find all objects. User selects `rtms__Load__c`.
2. **Mapping:** The user maps `Weight` to QuickBooks `Memo`. The logic is saved as Database Metadata.
3. **Validation:** The AI validates the mapping against live Production metadata to ensure the fields exist.

#### Step 4: Execution (The Pipeline)

1. A Load is updated in Salesforce.
2. The Source Gateway catches the event and routes it to the physical Salesforce schema.
3. The engine fans out, identifying that this record belongs to the "Finance Division" route.
4. The Delivery Engine refreshes the QuickBooks token (if needed) and pushes the data.
5. The user views the Route Intelligence dashboard to see the green trace from L1 to L6.

### 8. Security & Compliance Summary

- **Physical Siloing:** Schema-per-connection namespace isolation.
- **VPC Hardening:** Sandbox and Production workers live in physically separated networks.
- **Credential Safety:** Tokens encrypted via AWS KMS; environment-locked via the Token Manager.
- **Audit Readiness:** Deterministic 6-layer trace ID for every business transaction.
- **Observability:** Unified SigNoz (OpenTelemetry) and Pino stack with PII redaction.

### 9. Core Technology Stack

| Layer | Technologies |
| --- | --- |
| Backend | NestJS (Fastify), Drizzle ORM, Atlas (DB Orchestration) |
| Frontend | React, Refine.dev, Shadcn UI, Lucide Icons |
| Infrastructure | AWS (Aurora Serverless, Fargate, SQS, KMS, Redis) |
| Integration | Activepieces (Connector Pieces Framework) |
| AI | Vercel AI SDK, Model Context Protocol (MCP) |
