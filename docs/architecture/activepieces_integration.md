# Activepieces Integration: Auth & Action Framework

To rapidly support 500+ integrations, FluxNex leverages the Auth, Property, and Action definitions from the open-source Activepieces ecosystem. We host these "Pieces" within our high-performance NestJS runtime, acting as a secure execution environment.

## 1. Borrowed Components (The Piece Framework)

We are not using the Activepieces orchestrator or scheduling engine. We strictly extract the `pieces-framework` to act as our HTTP client and UI metadata layer:

- **Property Framework (`Property.*`):** A type system defining inputs (e.g., `ShortText`, `OAuth2`). It allows the backend to send a JSON Schema to the React frontend to dynamically generate connection forms.
- **Piece Auth Framework (`PieceAuth`):** Standardized definitions of how apps authenticate (OAuth2 URLs, Scopes, Basic Auth). It powers our native NestJS OAuth2 handshake and Refresh Token loops.
- **Action Framework (`createAction`):** The execution wrapper containing the `run(context)` function that fires the actual HTTP requests.
- **Pieces Ecosystem:** The actual integration logic for 200+ SaaS apps (Salesforce, QuickBooks, HubSpot, etc.) maintained by the community.

## 2. The Piece Executor (The Bridge)

We provide a secure "Host" environment within the FluxNex Platform Layer to execute the Application Layer code (Borrowed Pieces).

### A. The Core Interfaces

We abstract the Activepieces codebase into generic interfaces owned by the FluxNex kernel.

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

This service fetches secure tokens from our database and injects them into the exact `Context` object that the Activepieces `run()` function expects.

```typescript
// packages/engine/src/executor/piece-executor.service.ts
import { Injectable } from '@nestjs/common';
import { TokenManagerService } from '@fluxnex/connectors/auth';
import { ConnectorAction } from '@fluxnex/connectors/framework';

@Injectable()
export class PieceExecutorService {
  constructor(private tokenManager: TokenManagerService) {}

  async executeAction(connectionId: string, action: ConnectorAction, mappedProps: any) {
    // 1. Get a guaranteed valid token (Handles Redis distributed refresh locks!)
    const credentials = await this.tokenManager.getValidCredentials(connectionId);

    // 2. Construct the exact Context that Activepieces expects
    const apContext = {
      auth: credentials.accessToken, 
      propsValue: mappedProps,
      
      // Mocked AP utilities for compatibility
      store: { get: async () => null, put: async () => null }, 
      connections: { get: async () => credentials } 
    };

    // 3. Run the Activepieces HTTP logic
    try {
      return await action.run(apContext);
    } catch (error) {
      throw new Error(`Execution Failed: ${error.message}`);
    }
  }
}
```

## 3. Directory & App Registry

Integrations are strictly isolated within the monorepo to ensure dependency safety.

```text
/packages/connectors
├── /framework            # The Host (Interfaces & PieceExecutor)
└── /apps                 # The Plugins (Direct copies from AP repo)
    ├── /salesforce
    ├── /quickbooks
    └── /index.ts         # Central Registry
```

### App Registry Loading

The registry allows the Sync Engine (Layer 5) to dynamically look up Actions without hardcoded imports.

```typescript
// packages/connectors/apps/index.ts
export const getAppAction = (appName: string, actionName: string) => {
  const app = apps[appName]; // apps = { salesforce, quickbooks, ... }
  if (!app) throw new Error(`App ${appName} not found`);
  
  const action = app.actions[actionName];
  if (!action) throw new Error(`Action ${actionName} not found in ${appName}`);
  
  return action;
};
```

## 4. The Token Refresh Engine

Layer 5 (Delivery) utilizes a Token Manager Service that handles distributed locks via Redis.

- **Concurrency Control:** If 100 concurrent workers request an expired token, only one worker acquires the Redis Lock to perform the HTTP refresh.
- **Wait & Retry:** Concurrent workers wait (exponential backoff) for the refresh to complete, then use the updated token from the database, preventing external API rate-limit bans and token invalidation.

## 5. Why this Strategy Wins

- **Infinite Scale:** Adding a new app requires zero changes to the core engine. We simply drop the Activepieces folder into `/apps` and export it in the registry.
- **Unified Auth:** Both the background Sync Engine and the AI Copilot use the exact same credential store and refresh logic.
- **Frontend Independence:** Because the backend provides the Property schema, the React frontend renders connection forms dynamically for any of the 500+ apps without needing custom UI code per integration.
