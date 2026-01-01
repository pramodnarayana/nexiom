# Technical Plan: Platform vs Application Split

## 1. Principles
- **Platform Code (`@fluxnex/core`)**: Reliable plumbing. Agnostic to business domain. Handles I/O, Queues, State, Retries.
- **Application Code (`apps/worker/src/integrations`)**: Business Logic. Defines *how* to parse, map, and validate.
- **Interaction**: Platform *invokes* Application code via strict Interfaces (Router/Handler pattern).

## 2. Monorepo Structure & Function Map

```text
/
├── packages/
│   └── core/                 # [PLATFORM] Generic Logic
│
├── apps/
│   ├── worker/               # [Host] Runs the Platform Workers
│   │   ├── src/
│   │   │   ├── integrations/ # [APPLICATION] Business Logic
│   │   │   │   ├── revenova/
│   │   │   │   │   ├── replica.ts          # [Source] Parsing Logic
│   │   │   │   │   ├── normalization/      # [Source] Mapping Logic
│   │   │   │   │   │   ├── router.ts
│   │   │   │   │   │   └── handlers/
│   │   │   │   │   │       ├── vendor.ts
│   │   │   │   │   │       └── load.ts
│   │   │   │   │   └── outbound/           # [Dest] Writing back to Revenova
│   │   │   │   │       └── invoice_status.ts
│   │   │   │   └── quickbooks/
│   │   │   │       ├── replica.ts          # [Source] Reading from QB
│   │   │   │       ├── normalization/      # [Source] Validation
│   │   │   │       │   ├── router.ts
│   │   │   │       │   └── handlers/
│   │   │   │       │       └── payment.ts
│   │   │   │       └── outbound/           # [Dest] Writing to QB
│   │   │   │           ├── vendor.ts
│   │   │   │           └── bill.ts
│   │   └── package.json
```

## 3. The Contract (Interfaces)

### Replica Handler Contract (Layer 2)
Platform invokes this to convert Raw Gateway Data -> Source Store.
The App Logic uses `ctx.save()` to delegate persistence and queuing to the Platform.

```typescript
// Implementation: integrations/revenova/replica.ts
import { PlatformContext } from '@fluxnex/core';

export async function RevenovaUpsertObject(ctx: PlatformContext, gatewayRecord: GatewayEntity) {
   // 1. Parsing Logic
   const type = gatewayRecord.xmlType; // 'sf:Account'

   // 2. Platform Call (Handles Tenant DB Insert + Queue Push)
   await ctx.save({
       entity_type: 'sf_account',
       data: gatewayRecord.parsedData
   });
}
```

### Normalization Handlers (Layer 3)
Specfic mapping logic invoked by the Router.
```typescript
// Implementation: integrations/revenova/normalization/handlers/vendor.ts
export async function UpsertTMSVendor(sourceRecord: any) {
   // Maps Source(Account) -> Canonical(TMS_VENDOR)
}
```

### Outbound Gateway Handlers (Layer 4)
Destination-specific mapping and validation.
```typescript
// Implementation: integrations/quickbooks/outbound/bill.ts
export async function CreateQBBillGatewayRecord(canonicalRecord: any) {
  // Maps Canonical(Invoice) -> QB(Bill)
  // Validates Business Rules
  // Creates Gateway Record for 'QB Logistics US'
}
```

## 4. Integration Strategies (Supported Patterns)

The Platform supports two methods for loading Application Logic.

### Strategy A: Convention-based Dynamic Loading (Original)
The Platform loads logic at runtime based on naming conventions. No explicit registration required.

**Pros**: Zero-config. Just add a file and it works.
**Cons**: No compile-time safety. Runtime errors if file/function is misspelled.

```typescript
// packages/core/src/pipeline/layer2_replica/worker.ts
async function processMessage(job: Job) {
  const { source_app, gateway_record } = job.data; 

  // 1. DYNAMIC IMPORT (Zero Config)
  // Convention: apps/worker/src/integrations/[app]/replica.ts
  const module = await import(`../../../../../apps/worker/src/integrations/${source_app}/replica`);
    
  // 2. RESOLVE FUNCTION
  // Convention: [CapitalizedAppName]UpsertObject
  const fnName = `${capitalize(source_app)}UpsertObject`; 
  const handler = module[fnName];

  if (!handler) throw new Error(`Function ${fnName} not found`);
  await handler(gateway_record);
}
```

### Strategy B: Distributed App Registries (Decentralized)
Each Application exports an "App Definition". The Platform loads these definitions at startup.

**Pros**: Type-safe. Explicit ownership. Fail-fast at boot time.
**Cons**: Requires one extra `index.ts` file per app.

**1. The App Registry (Application Code)**
```typescript
// apps/worker/src/integrations/revenova/index.ts
import { RevenovaUpsertObject } from './replica';
import { route } from './normalization/router';

export const RevenovaApp: AppDefinition = {
  name: 'revenova',
  replicaHandler: RevenovaUpsertObject,    
  normalizationRouter: route
};
```

**2. Bootstrapping (Host Application)**
```typescript
// apps/worker/src/index.ts
import { PlatformEngine } from '@fluxnex/core';
import { RevenovaApp } from './integrations/revenova';

// Load
PlatformEngine.load(RevenovaApp);
```
