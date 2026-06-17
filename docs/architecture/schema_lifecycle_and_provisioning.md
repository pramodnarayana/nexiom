# Architecture: Schema Lifecycle & Lazy Provisioning

This document defines the timing and triggers for database schema creation within the FluxNex 6-layer pipeline. To ensure maximum scalability, we follow a Lazy Provisioning strategy—nothing is created until there is active intent from the user.

1. Provisioning Lifecycle Summary
| Lifecycle Event | Physical Action | Component Responsible | Status |
| --------------- | --------------- | ----------------------- | ------ |
| App Authentication | Create Schema Namespace (ws_{id}) | api-gateway / dbmanager | Empty Silo |
| Route Activation | Create Kernel Tables (Ingest/Logs) | dbmanager (Atlas) | Active Silo |
| Object Selection | Initialize Unified Replica (replica_entity) | dbmanager (Atlas) | Data Ready |

2. Event-Driven Provisioning Details
Stage 1: Connection Handshake (The "Namespace" Event)
Trigger: User successfully completes an OAuth or API Key handshake.
Database Action: CREATE SCHEMA IF NOT EXISTS "ws_sf_101".
Registry Action: Insert row into public.connection_storage_registry.
Result: A physical "Wall" is established. The schema is empty, incurring zero index or metadata overhead in the Postgres catalog.
Stage 2: Route Activation (The "Kernel" Event)
Trigger: User creates a Route (e.g., Salesforce → QuickBooks) and clicks "Save & Activate."
Database Action: The dbmanager uses Atlas to deploy the Pipeline Kernel tables into the connection's schema.
Tables Created: * `inbound_gateway`: Stores raw ingestion data.
*(Note: `sync_log`, `sync_cursor`, and `outbound_gateway` are planned additions for future Gateway integration).*
Stage 3: Object Mapping (The "Storage Initialization" Event)
Trigger: User selects a specific object (e.g., "Accounts") in the Mapping UI.
Database Action: The system ensures the structured state store is ready. It executes the SQL to create:
replica_entity: The unified JSONB state store for ALL objects in this connection.
GIN Indexes: Applied to the data column to enable high-speed search across all fields and custom objects.
Optimization: This table is created once per connection and handles all object types (Account, Contact, etc.) through the entity_type column.

3. The 6-Layer Readiness Matrix
This matrix shows which physical tables must be "ready" before a specific layer worker can process a job.
| Layer | Dependency | Physical Location | Why? |
| ----- | ---------- | ----------------- | ---- |
| L1: Source Gateway | inbound_gateway | ws_source | To log the "evidence" of the raw webhook. |
| L2: Universal Replica | replica_entity | ws_source | To store the parsed source-of-truth. |
| L3: Normalization | normalized_entity | ws_source | To store the platform-standard JSON. |
| L4: Outbound Prep | field_mapping | public | To read the rules defined by the user. |
| L5: Delivery Engine | N/A | N/A | Pure I/O. Does not write to tenant schemas. |
| L6: Dest. Gateway | outbound_gateway | ws_dest | To log the destination API response. |

4. Engineering Implementation: The "Ensure" Pattern
Because workers are asynchronous, a webhook (L1) might arrive before the dbmanager has finished creating the tables. To prevent crashes, all workers follow the Ensure Pattern:
// packages/engine/src/workers/base.worker.ts
async function processLayerJob(connectionId: string, payload: any) {
  // 1. Resolve Schema Name
  const schema = await storageResolver.resolve(connectionId);
  const { tenantId, appName, appProfile } = payload.context;

  // 2. JIT Check (The "Ensure" step)
  // If the tables are missing, the worker triggers a fast schema plan apply
  await dbmanager.applyPlan(tenantId, schema, SchemaPlan.STANDARD_ACTIVE, { appName, appProfile });

  // 3. Perform Business Logic
  await db.withSchema(schema).insert(...);
}

1. Benefits of this Timing
Catalog Leanliness: We avoid the "Postgres Metadata Bloat" that occurs when thousands of unused tables exist in the system.
Speed: App connection is instantaneous because it only creates a namespace.
Isolation: The architecture guarantees that no worker ever attempts to write to a "Shared" schema; it is always scoped to the connection-specific workspace.
