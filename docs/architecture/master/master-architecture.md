# FluxNex: Master Architecture & UI Specification

This document serves as the single source of truth for the FluxNex platform. It defines the technical design of the 6-layer sync engine, the physical database isolation strategy, and the frictionless user experience for customers and support teams.

---

## I. The Sync Engine: 6-Layer Architecture

FluxNex uses a Staged Event-Driven Architecture (SEDA) to ensure data is processed deterministically with an immutable audit trail.

### 1. The Processing Layers

| Layer | Name | Responsibility | Physical Write Location |
| --- | --- | --- | --- |
| L1 | Source Gateway | Ingest raw webhooks/polls. | `ws_source.inbound_gateway` |
| L2 | Universal Replica | Parse raw JSON into a state mirror. | `ws_source.replica_entity` |
| L3 | Normalization | Convert to Canonical Model (e.g., `TMS_LOAD`). | `ws_source.normalized_entity` |
| L4 | Transformation | Apply filters and hydrate target JSON. | In-Memory (using `public.field_mapping`) |
| L5 | Delivery Engine | Execute authenticated API call to target. | External API call |
| L6 | Dest. Gateway | Log API response and final status. | `ws_dest.outbound_gateway` |

### 2. Table Designs (Tenant Schema)

Every connection instance receives its own physical Postgres schema containing these tables:

- **`inbound_gateway`:** `id`, `trace_id`, `payload` (JSONB), `external_id`, `status`.
- **`replica_entity`:** `id`, `source_id`, `entity_type` (e.g., `'Account'`), `data` (JSONB).
  - **GIN Index:** Applied to `data` to enable high-speed search across custom fields.
- **`normalized_entity`:** `id`, `canonical_type`, `data` (JSONB).
- **`outbound_gateway`:** `id`, `trace_id`, `request_payload` (JSONB), `response_payload` (JSONB), `status_code`.

---

## II. Local Development & Simulation

FluxNex is designed to be 100% cloud-agnostic for the local "Inner Loop."

### 3. Local Infrastructure Stack

Developers run a `docker-compose` stack that emulates AWS:

- **Postgres:** Standard Alpine image (replaces Aurora).
- **LocalStack:** Emulates SQS (Queues) and KMS (Encryption).
- **Redis:** Handles distributed refresh locks for OAuth tokens.
- **Prism:** Mocks third-party APIs (Salesforce/QuickBooks) using OpenAPI specs.

### 4. End-to-End Local Testing

1. **Initialize:** `pnpm run db:migrate` initializes the public schema.
2. **Authenticate:** Use `localhost:3000` to create a connection. The system creates a local schema `ws_sf_test`.
3. **Simulate:** Use `curl` to send a JSON payload to the local gateway endpoint.
4. **Verify:** Observe logs in the terminal and inspect the local Postgres schema to see the data flow from L1 to L6.

---

## III. Product & UI Specification

The UI is designed to handle enterprise complexity with a "Zero-Friction" philosophy.

### 5. Environment Management (Sandbox vs. Production)

- **The Connection Dropdown:** Every connection form has an Environment Dropdown `[ Sandbox | Production ]`.
- **Automatic Routing:**
  - **Sandbox:** Routes data to a standard RDS Cluster and uses vendor test URLs.
  - **Production:** Routes data to a high-availability Aurora Cluster and uses live URLs.
- **Visibility:** Sandbox connections are automatically made available only in Sandbox-tagged Workspaces.

### 6. Logical Workspaces (Folders)

- **Creation:** Admins create Workspaces (e.g., "Logistics-US," "Logistics-CA") to group related integrations.
- **Assignment:** Active connections are "invited" into a Workspace. A single connection can be shared across multiple workspaces.
- **Privacy:** Users are granted access to specific Workspaces, creating "Walls" between departments (e.g., HR cannot see Finance).

### 7. Route Creation & Intelligence

- **Dynamic Object Discovery:** When a user selects a source connection in the Mapping Canvas, the system calls the source API live to discover all available objects (Standard + Custom).
- **Conditional Sync:** Users add rules (e.g., `IF Region == 'US'`) directly on the route.
- **AI-Assisted Mapping:** Mappings are metadata-driven. The AI scans existing Sandbox mappings to propose Production mappings, accounting for any field drift between the two environments.

---

## IV. Architectural Verdict: Elite Enterprise Grade

- **Physical Siloing:** Schema-per-connection is the most secure multi-tenant isolation pattern.
- **Pre-Sharding:** The Registry allows moving physical silos across servers without breaking UI links.
- **Audit Readiness:** The 6-layer pipeline provides a complete "flight recorder" for every record, satisfying SOC2/HIPAA.
- **Zero-Migration Scale:** JSONB + GIN indexing allows supporting 500+ apps and custom fields without ever running a database migration.
