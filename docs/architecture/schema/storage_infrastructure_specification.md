# Storage Infrastructure: Registry & Resolver

This document defines the Infrastructure Router pattern used by FluxNex to decouple business identities from physical data silos. This separation enables zero-downtime sharding, regional data residency, and clean schema management.

## 1. Storage Registry Schema (Drizzle ORM)

This table lives in the public schema and acts as the global map for the platform's physical infrastructure.

```typescript
import { pgTable, uuid, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { appConnections } from "./app_connection";

/**
 * THE INFRASTRUCTURE REGISTRY
 * Maps a connectionId to its physical database location.
 */
export const connectionStorageRegistry = pgTable(
  "connection_storage_registry",
  {
    // 1. Foreign Key to the business connection
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => appConnections.id, { onDelete: "cascade" })
      .primaryKey(),

    // 2. The physical Postgres Schema name (e.g., 'ws_sf_101')
    // This is used for 'SET search_path TO ...'
    workspaceId: varchar("workspace_id", { length: 128 }).notNull(),

    // 3. The Physical RDS/Cluster ID
    // Tells the DB Manager which instance to target for migrations/queries
    databaseHostId: varchar("database_host_id", { length: 255 })
      .default("primary-cluster")
      .notNull(),

    // 4. Compliance/Region Context
    // Ensures data sovereignty requirements are met
    regionContext: varchar("region_context", { length: 50 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  }
);
```

## 2. Storage Resolver Service (NestJS)

The Resolver is the runtime bridge used by Sync Workers (Layers 1-6) to identify where to read or write data.

```typescript
import { Injectable, NotFoundException, Inject } from "@nestjs/common";
import { DrizzleDb, DATABASE_CONNECTION, connectionStorageRegistry } from "@soopa/database";
import { eq } from "drizzle-orm";

@Injectable()
export class StorageResolverService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  /**
   * Resolves the physical PostgreSQL schema name (workspaceId) for a connection.
   * Used by Ingestion and Replica workers for 'SET search_path'.
   */
  async resolveSchemaName(connectionId: string): Promise<string> {
    const registryEntry = await this.db
      .select({ workspaceId: connectionStorageRegistry.workspaceId })
      .from(connectionStorageRegistry)
      .where(eq(connectionStorageRegistry.connectionId, connectionId))
      .limit(1);

    if (registryEntry.length === 0) {
      throw new NotFoundException(
        `Infrastructure Error: Connection ${connectionId} has no physical storage workspace assigned.`,
      );
    }

    return registryEntry[0].workspaceId;
  }

  /**
   * Retrieves host and region context for the connection.
   * Critical for multi-region routing and residency compliance.
   */
  async getHostContext(connectionId: string) {
    const registryEntry = await this.db
      .select()
      .from(connectionStorageRegistry)
      .where(eq(connectionStorageRegistry.connectionId, connectionId))
      .limit(1);

    if (registryEntry.length === 0) {
      throw new NotFoundException(
        `No infrastructure registry found for connection: ${connectionId}`,
      );
    }

    return registryEntry[0];
  }
}
```

## 3. Implementation Workflow

| Phase        | Responsibility       | Physical Action                                                                    |
| ------------ | -------------------- | ---------------------------------------------------------------------------------- |
| Creation     | packages/connections | User authenticates. A new UUID is generated in app_connection.                     |
| Provisioning | packages/dbmanager   | System creates `ws_{id}` schema and adds a row to `connection_storage_registry`.   |
| Ingestion    | packages/engine (L1) | Worker calls `resolveSchemaName()` to find the target schema for raw storage.      |
| Sharding     | Infrastructure Ops   | Schema is moved to a new host; only `database_host_id` in the registry is updated. |

## 4. Key Architectural Benefits

- **Identity Purity**: The `app_connection` table remains focused on credentials and business metadata, unaware of database hostnames or schema naming conventions.
- **Schema Isolation**: By resolving the `workspaceId` at runtime, workers can dynamically switch contexts, ensuring data from different app instances never co-mingle.
- **Regional Sovereignty**: The `region_context` allows the engine to ensure that a connection's data is only ever processed or stored on hardware within a specific legal jurisdiction.
