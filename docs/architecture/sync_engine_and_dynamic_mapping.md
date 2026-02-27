# Architecture: Sync Engine and Dynamic Mapping

This document details the architecture for the FluxNex integration platform. It outlines how we combine our state-based, 6-Layer Sync Engine with the open-source action definitions from Activepieces, all powered by a Customer-Defined Dynamic Mapping UI.

## 1. Directory Structure

To maintain a strict separation of concerns, the monorepo is divided into the Platform Engine (which moves data) and the Connectors/Application Logic (which defines APIs and data shapes).

```text
/fluxnex-monorepo
├── /packages
│   ├── /identity                 # Tenant & User management
│   ├── /database                 # Drizzle ORM schemas (Global & Tenant)
│   │
│   └── /connectors               # THE UNIFIED CONNECTORS PACKAGE
│       ├── /framework            # The Foundation (Interfaces stripped from AP)
│       │   ├── /property         # Borrowed: Property/UI definitions
│       │   ├── /auth             # Borrowed: PieceAuth definitions
│       │   └── /action           # Borrowed: Action definitions & Context
│       │
│       └── /apps                 # THE APPLICATION LAYER (APIs)
│           ├── /salesforce       # Directly copied from Activepieces repo
│           ├── /quickbooks       # Directly copied from Activepieces repo
│           └── /index.ts         # Registry to load apps dynamically
│
├── /engine                       # THE PLATFORM ENGINE (Layers 1-6)
│   ├── /src/workers              # Queue Consumers (Ingestion, Replica, Delivery, etc.)
│   ├── /src/hydrator             # Dynamic JSON Templating Engine
│   └── /src/executor             # The Bridge running Activepieces code
```

## 2. What code we will be borrowing from Activepieces

> [!WARNING]
> **Activepieces Licensing & Attribution Requirement**
>
> The Activepieces code we are borrowing is **MIT-licensed**. When copying files from the Activepieces repository into the FluxNex monorepo, developers **must**:
>
> 1. Preserve the original MIT license headers in every copied file.
> 2. Include file-level attribution indicating the code originated from Activepieces.
>
> Please refer to the [Integration Compliance Checklist](../../docs/compliance/CHECKLIST.md) which provides explicit guidance on verifying preserved headers, including attribution, and recording the source repository and commit hash.

We are not using the Activepieces workflow orchestrator, DAG engine, or scheduling systems. We are only extracting their highly robust `pieces-framework` to act as our HTTP client layer.

Specifically, we are borrowing four things:

- **The Property Framework (`Property.*`)**
  - *What it is:* A type system defining inputs (e.g., `Property.ShortText()`, `Property.OAuth2()`).
  - *Why we need it:* It allows the backend to send a JSON Schema to the React frontend, dynamically generating connection forms and mapping UIs for 200+ apps without writing custom frontend code.
- **The Piece Auth Framework (`PieceAuth`)**
  - *What it is:* The standardized definition of how an app authenticates (OAuth2 URLs, Scopes, Basic Auth).
  - *Why we need it:* It powers our native NestJS OAuth2 handshake and Refresh Token loops.
- **The Action Framework (`createAction`)**
  - *What it is:* The execution wrapper containing the `run(context)` function that fires the HTTP request.
  - *Why we need it:* It provides production-tested HTTP execution logic for thousands of endpoints.
- **The Pieces Ecosystem (`packages/pieces/*`)**
  - *What it is:* The actual integration folders (e.g., `salesforce`, `quickbooks`) built by the community.
  - *Why we need it:* By copying these folders, we instantly gain read/write capabilities for hundreds of SaaS platforms without reading their API documentation.

## 3. Foundation work to borrow code from Activepieces

To use the Activepieces code, we must build a secure "Host" environment within FluxNex. This foundation bridges our internal NestJS database credentials with the Activepieces `run()` functions.

### A. The Core Interfaces

We abstract the Activepieces codebase into generic interfaces owned by the FluxNex kernel (`packages/connectors/framework`).

```typescript
// packages/connectors/framework/src/action.ts
export interface ConnectorAction {
  name: string;
  displayName: string;
  description: string;
  run: (context: ActionContext) => Promise<any>;
}

export interface ActionContext {
  auth: any;                       // The decrypted token/key injected by Layer 5
  propsValue: Record<string, any>; // The hydrated JSON payload from the UI mapping
}
```

### B. The Piece Executor Service

This NestJS service acts as the bridge. It fetches secure tokens from our database and injects them into the exact Context object that Activepieces expects.

```typescript
// packages/engine/src/executor/piece-executor.service.ts
import { Injectable } from '@nestjs/common';
import { TokenManagerService } from '@fluxnex/connectors/auth';
import { ConnectorAction } from '@fluxnex/connectors/framework';

@Injectable()
export class PieceExecutorService {
  constructor(private tokenManager: TokenManagerService) {}

  /**
   * Executes an Activepieces action using FluxNex credentials.
   */
  async executeAction(connectionId: string, action: ConnectorAction, mappedProps: any) {
    // 1. Get a guaranteed valid token (Handles Redis distributed refresh locks!)
    const credentials = await this.tokenManager.getValidCredentials(connectionId);

    // 2. Construct the exact Context that Activepieces expects
    const apContext = {
      auth: credentials.accessToken,
      propsValue: mappedProps,

      // Activepieces uses these for internal execution, we mock or provide them safely
      store: { get: async () => null, put: async () => null }, 
      connections: { get: async () => credentials } 
    };

    // 3. Run the Activepieces HTTP logic
    try {
      const result = await action.run(apContext);
      return result;
    } catch (error) {
      throw new Error(`Execution Failed: ${error.message}`);
    }
  }
}
```

## 4. Sync Engine: Platform Layer

The Platform Layer (`packages/engine`) is "dumb" to business logic. It does not know what a "Vendor" or "Salesforce" is. It strictly moves data between queues, hydrates templates, and calls the Executor Foundation.

### Layer 4: Outbound Prep Worker (The Hydrator)

Layer 4 grabs the internal Canonical data, fetches the user's specific mapping template from the DB, and "Hydrates" it to create the exact JSON structure the destination API expects.

```typescript
// packages/engine/src/workers/layer4_outbound.worker.ts
import { db } from '@fluxnex/database';
import { hydrateTemplate } from '../hydrator'; // Engine utility (e.g., Handlebars/Mustache)

export class OutboundPrepWorker {
  async process(canonicalRecord: any, canonicalType: string) {

    // 1. Fetch the Customer's Dynamic Mapping from the UI
    const routes = await db.query.fieldMappings.findMany({
       where: eq(fieldMappings.sourceCanonical, canonicalType)
    });

    for (const route of routes) {
      try {
        // 2. Hydrate the JSON Template with actual canonical data
        // e.g., "{{vendorName}}" becomes "Acme Logistics"
        const hydratedProps = hydrateTemplate(route.mappingTemplate, canonicalRecord);

        // Ensure hydration resulted in a valid format before dispatching
        if (!hydratedProps || typeof hydratedProps !== 'object') {
          throw new Error('Hydration failed: returned invalid mapped payload object.');
        }

        // 3. Send to Layer 5 for HTTP Execution
        await queue.add('Outbound_Queue', {
          connectionId: route.connectionId, 
          targetApp: route.targetApp,       // e.g., 'quickbooks'
          targetAction: route.targetAction, // e.g., 'create_vendor'
          propsValue: hydratedProps         // The fully mapped JSON payload
        });
      } catch (error) {
        processLogger.error('Failed to process outbound route', {
           connectionId: route.connectionId,
           targetApp: route.targetApp,
           targetAction: route.targetAction,
           canonicalType,
           error: error.message
        });
        // Continue loop to process other mappings, letting this specific route fail
      }
    }
  }
}
```

### Layer 5: Delivery Worker (The Action Dispatcher)

Layer 5 pulls from the queue, looks up the requested Activepieces Action, and hands it to the Executor Foundation. Rate limiting and retries are handled natively by the Queue wrapper (BullMQ/SQS) here.

```typescript
// packages/engine/src/workers/layer5_delivery.worker.ts
import { Worker, Job } from 'bullmq';
import { PieceExecutorService } from '../executor/piece-executor.service';
import { getAppAction } from '@fluxnex/connectors/apps';

export class DeliveryWorker {
  constructor(private executor: PieceExecutorService) {
    new Worker('Outbound_Queue', async (job: Job) => {
      const { connectionId, targetApp, targetAction, propsValue } = job.data;

      // 0. Idempotency Check
      if (await isDuplicateDelivery(job.id)) {
        processLogger.warn(`Duplicate job execution prevented for ${job.id}`);
        return;
      }

      // 1. Load the Action Definition (Borrowed from Activepieces)
      const actionToRun = getAppAction(targetApp, targetAction);

      try {
        // 2. Execute via the Platform Foundation
        const result = await this.executor.executeAction(
           connectionId, 
           actionToRun, 
           propsValue
        );

        // 3. Save success state to Global_Entity_Map DB
        await markDeliverySuccess(connectionId, result.id, job.id);
      } catch (error) {
        // 4. Handle partial failures and retries
        await markDeliveryFailure(connectionId, error.message, job.id);
        throw error; // Let BullMQ handle exponential backoff
      }
    });
  }
}
```

### State Persistence & Idempotency Strategy

Maintaining the integrity of sync pipelines requires highly durable state persistence.

We use the `Global_Entity_Map` (or dedicated delivery tracking) to capture exactly **what** has synced and **whether** it succeeded:

- **What to persist:** `source_id`, `target_id`, `last_synced_at`, `delivery_status` (`PENDING`, `SUCCESS`, `FAILED`), `attempt_count`, and `last_error`.
- **When to persist:**
  - Before a message is dispatched to the executing action, ensure it runs under the protection of `isDuplicateDelivery(job.id)`.
  - Update to `SUCCESS` via `markDeliverySuccess()` if the HTTP call completes cleanly.
  - Default to `FAILED` with specific stack traces via `markDeliveryFailure()` if it breaks.
- **Handling Partial Failures:** A failure increments the `attempt_count` inside the persistence layer. The `throw error` safely kicks the queue payload back to the scheduler, backing off exponentially, while compensating tracking functions keep analytics dashboards in sync.

## 5. Sync Engine: Application Layer

The Application Layer is the "smart" layer. It contains your business logic, canonical definitions, and the actual API integration code.

Because we decoupled the Platform, the Application layer can scale infinitely. To add a new integration, a developer simply drops a new Activepieces folder into `packages/connectors/apps`. No queue, retry, or auth code needs to be written.

### App Registry Loading

The Application Layer maintains a registry that allows the Platform Layer to dynamically look up Actions without hardcoding imports.

```typescript
// packages/connectors/apps/index.ts
import { ConnectorAction } from '../framework';

// Pre-define available apps for validation without loading all code into memory
const availableApps = ['salesforce', 'quickbooks'] as const;
export type SupportedApp = typeof availableApps[number];

/**
 * Dynamically loads an app module and retrieves an action.
 * Uses lazy-loading to optimize memory usage (500+ apps won't all be in RAM).
 */
export const getAppAction = async (appName: string, actionName: string): Promise<ConnectorAction> => {
  if (!availableApps.includes(appName as SupportedApp)) {
    throw new Error(`App '${appName}' not found. Available apps: ${availableApps.join(', ')}`);
  }
  
  // Lazy load the specific app's piece definition
  const appModule = await import(`./${appName}`);
  const app = appModule[`${appName}Piece`]; // e.g. salesforcePiece
  
  const action = app.actions[actionName];
  if (!action) {
    const availableActions = Object.keys(app.actions).join(', ');
    throw new Error(`Action '${actionName}' not found in '${appName}'. Available actions: ${availableActions}`);
  }
  
  // Runtime validation ensuring the Action conforms to the Interface
  if (typeof action.run !== 'function') {
      throw new Error(`Action '${actionName}' is invalid: missing 'run' execution function.`);
  }
  
  return action as ConnectorAction;
};
```

## 6. Dynamic Mapping

Instead of hardcoding how a Canonical model maps to an external app (e.g., writing `if (app === 'qb') return { DisplayName: record.name }`), we provide a visual UI where the customer maps fields using a drag-and-drop builder.

This configuration is saved securely in the Tenant's isolated database schema and consumed by Layer 4.

### Database Schema

```typescript
// packages/database/src/schema/tenant/field_mapping.ts
import { pgTable, uuid, varchar, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { appConnection } from './app_connection';

export const fieldMappings = pgTable('field_mapping', {
  id: uuid('id').defaultRandom().primaryKey(),
  
  // Link to the specific OAuth connection to use (Enforces Referential Integrity)
  connectionId: uuid('connection_id')
    .notNull()
    .references(() => appConnection.id, { onDelete: 'cascade' }),
  
  // Routing rules
  sourceCanonical: varchar('source_canonical').notNull(), // e.g., 'TMS_VENDOR'
  targetApp: varchar('target_app').notNull(),             // e.g., 'quickbooks'
  targetAction: varchar('target_action').notNull(),       // e.g., 'create_vendor'
  
  // The JSON template defined by the Customer in the UI
  mappingTemplate: jsonb('mapping_template').notNull(),
}, (table) => {
  return {
    // 1. Optimize lookups when a webhook arrives (Layer 4 worker queries this)
    sourceCanonicalIdx: index('idx_field_mapping_source_canonical')
      .on(table.sourceCanonical),
      
    // 2. Composite index for faster joint lookups
    routingCompositeIdx: index('idx_field_mapping_routing')
      .on(table.sourceCanonical, table.targetApp, table.targetAction),
      
    // 3. Prevent duplicate mappings for the SAME connection + action
    // A user shouldn't map 'TMS_VENDOR' to 'QB Create Vendor' twice on the same QB account
    uniqueMappingConstraint: uniqueIndex('unq_connection_mapping_route')
      .on(table.connectionId, table.sourceCanonical, table.targetApp, table.targetAction)
  };
});
```

### How the UI Saves Data (mappingTemplate)

The frontend reads the Activepieces Property framework for QuickBooks to know what fields exist (e.g., `DisplayName`, `PrimaryEmailAddr`). When the customer drags their Canonical "Vendor Name" to the QuickBooks "DisplayName" field, the UI saves this exact JSON template to the DB:

```json
{
  "DisplayName": "{{vendorName}}",
  "PrimaryEmailAddr": {
    "Address": "{{contactEmail}}"
  },
  "PrintOnCheckName": "{{vendorName}} (Via FluxNex)"
}
```

**The Loop:** When a webhook arrives, Layer 1-3 normalizes it into a Canonical `TMS_VENDOR` record. Layer 4 queries the `field_mapping` table, finds this JSON template, injects the real data replacing the `{{ }}` tags, and sends the final payload to Layer 5 where the Activepieces foundation executes the HTTP request.
