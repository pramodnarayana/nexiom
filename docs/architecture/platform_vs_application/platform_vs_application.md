# Architecture: Platform vs. Application Layer Separation

FluxNex is built on a "Kernel vs. Userland" philosophy. By strictly separating the underlying integration infrastructure (Platform) from the specific business logic of connectors (Application), we ensure that the system can scale to thousands of integrations without becoming a monolithic bottleneck.

## 1. The Core Boundary

| Feature | Platform Layer (The Kernel) | Application Layer (The Userland) |
|---|---|---|
| Location | packages/engine, packages/connections/auth | packages/connections/apps, packages/domain |
| Persona | Infrastructure / Core Engineers | Integration / "App" Engineers |
| Responsibility | Queues, SEDA Pipeline, Encryption, Siloing | API Handshakes, Field Mappings, Data Parsing |
| Stability | Immutable (rarely changes) | Highly Dynamic (updated daily) |
| Technology | NestJS, Fastify, Drizzle, AWS SDK, Redis | Activepieces Piece Framework, Zod, JSON |

## 2. Platform Layer: The "Dumb" Engine

The Platform Layer provides the Runtime Environment. It manages the "plumbing" of data movement but has zero knowledge of the business meaning of the data it carries.

**Key Responsibilities:**

- **Storage Orchestration (The Silo):** Using the Storage Registry to resolve `connection_id` to physical Postgres schemas (`ws_{id}`).
- **Concurrency Control:** Managing the Redis Distributed Refresh Lock to prevent SaaS API bans.
- **SEDA Pipeline Management:** Moving messages through the 6-layer SQS/BullMQ queues.
- **Security & Identity:** Managing the public organization and user tables and performing AWS KMS encryption/decryption of credentials.
- **The Hydrator:** A generic utility that merges Canonical JSON with customer Mapping Templates.

## 3. Application Layer: The "Smart" Plugins

The Application Layer contains the Business Intelligence. It defines how to talk to the outside world and how data should be structured.

**Key Responsibilities:**

- **Connector Definitions (Pieces):** Borrowed from the Activepieces ecosystem. These define the auth, actions, and triggers for specific apps (Salesforce, QuickBooks, etc.).
- **Metadata Discovery:** Implementing the `IDiscoveryAdapter` to tell the platform which objects (Accounts, Loads) exist in the source system.
- **Canonical Models:** Defining standardized interfaces (e.g., `TMS_LOAD`) in `packages/domain`.
- **Custom Logic:** Housing tenant-specific overrides in Fleet Sharded Git Repositories.

## 4. The Bridge: Interfaces & Adapters

The two layers communicate through a set of strict, versioned interfaces. This ensures that an update to the Salesforce connector code (Application) cannot crash the Sync Engine (Platform).

### The Execution Bridge

When Layer 5 (Delivery) needs to run an action, it calls the `PieceExecutorService`:

```typescript
// Platform calls this...
const result = await pieceExecutor.execute(connectionId, actionDefinition, payload);
// ...which injects the Platform's decrypted Auth into the Application's run() function.
```

### The Discovery Bridge

The UI calls the `MetadataService` to hydrate the Mapping Canvas:

```typescript
// Platform routes this request...
const schema = await discoveryAdapter.describe(auth, "rtms__Load__c");
// ...to the Application's Salesforce-specific metadata logic.
```

## 5. Why this Separation Wins

### A. Infinite Functional Scaling

To add the 501st app, a developer only works in the `/integrations` or `packages/connections/apps` folder. They never touch the code that handles database transactions, queue retries, or multi-tenancy.

### B. Zero-Downtime Plugin Updates

Since connectors are treated as "Data Definitions" (Metadata), we can update a mapping or a piece's API endpoint without restarting the core NestJS engine.

### C. Security Isolation

Platform engineers manage the "Vault" (KMS/DB), while App engineers only ever see the "Interface" (Context). Raw credentials are only injected into the memory of the runner at the exact millisecond of the API call.

### D. AI Readiness (MCP)

By separating the "Tool Definition" (Application) from the "Execution Logic" (Platform), we can easily expose the entire Application Layer as an MCP Server, allowing the AI Copilot to use the connectors autonomously without granting it access to the platform's internal state.

## 6. Summary for Development

- **Touch the Platform** if you are changing **how** data moves (latency, encryption, sharding).
- **Touch the Application** if you are changing **what** data moves (new apps, new fields, new mapping logic).
