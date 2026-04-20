# JSONata Inbound Normalization Strategy

> Documenting the architectural decision for dynamic canonical data transformation.  
> Status: **APPROVED**  
> Context: Normalizing L2 Replica data to L3 Canonical data in the CDC pipeline.

## 1. Problem Statement

During the L2 → L3 synchronization step, raw vendor payload data (e.g., Salesforce `Account`) must be normalized into the platform's standardized Canonical Objects (e.g., `TMS_CARRIER`).

A purely programmatic mapping strategy (1-to-1 key mapping in TypeScript) fails enterprise requirements because:
1. **Inflexibility**: Real-world integrations frequently require concatenating strings, conditionally mapping statuses, or parsing sub-objects.
2. **Hardcoded**: Field transformations require engineering sprints to push new code rather than being configurable by Success/Support teams.
3. **No Central Source of Truth**: The mapping logic is locked inside individual `Piece` definitions rather than being deterministically manageable via a UI.

## 2. Solution: JSONata Expression Engine

[JSONata](https://jsonata.org/) is a lightweight query and transformation language for JSON data. By replacing hardcoded TypeScript property mapping with JSONata evaluation, we gain full iPaaS-level transformation capabilities.

### Example Transformation
Notice how complex concatenation and conditional logic is natively supported as a single flat string.

**From Raw Input:**
```json
{
  "rtms__Pickup_Date__c": "2026-04-20T10:00:00Z",
  "Status__c": "Completed",
  "contact": { "FirstName": "John", "LastName": "Doe" }
}
```

**JSONata Expression:**
```jsonata
{
  "pickupDate": $substring(rtms__Pickup_Date__c, 0, 10),
  "status": Status__c = "Completed" ? "DELIVERED" : "PENDING",
  "driverName": contact.FirstName & " " & contact.LastName
}
```

## 3. High-Performance Implementation (CDC Safe)

Executing JSONata implies a runtime interpretation penalty. In a high-throughput CDC pipeline (processing potentially thousands of CDC operations per second), evaluating fresh JSONata strings per event is extremely CPU-expensive.

To maintain near real-time synchronization (< 500ms total latency), **all JSONata expressions must be compiled to an AST (Abstract Syntax Tree) exactly once**.

### The Cache Pattern

We enforce a strict AST-caching mechanism inside the worker modules (`NormalizerFn`).

```typescript
import jsonata from 'jsonata';
import type { NormalizerFn, CanonicalType } from '@nexiom/piece-framework';

// In future iterations, this is fetched dynamically from Postgres
const metadataDictionary: Record<string, { type: CanonicalType; mappingExpr: string }> = {
    'rtms__Load__c': {
        type: 'TMS_LOAD',
        mappingExpr: `{
            "displayName": name_,
            "pickupDate": $substring(rtms__Pickup_Date__c, 0, 10),
            "status": Status__c = "Completed" ? "DELIVERED" : "PENDING"
        }`
    }
};

// GLOBAL CACHE: Survives across SQS message executions.
const compiledMappings = new Map<string, jsonata.Expression>();

export const upsertTMSObject: NormalizerFn = async (replica) => {
    const meta = metadataDictionary[replica.entityType];
    if (!meta) return null;

    // 1. AST CACHE LOOKUP
    let expression = compiledMappings.get(replica.entityType);
    
    // 2. LAZY COMPILATION
    if (!expression) {
        expression = jsonata(meta.mappingExpr);
        compiledMappings.set(replica.entityType, expression); // Cache the AST
    }

    // 3. FAST EVALUATION
    const canonicalFields = await expression.evaluate(replica.data);
    const sourceId = replica.data.Id ?? replica.data.id ?? null;

    return {
        canonicalType: meta.type,
        sourceId: sourceId !== null ? String(sourceId) : undefined,
        data: canonicalFields,
    };
};
```

## 4. Why This Architecture Scales (Phase 3)

Deploying JSONata *now* unlocks a massive enterprise feature for the future (Phase 3 of the Nexiom Roadmap): **Dynamic Integration Builder UI**.

1. **Database Storage**: The `mappingExpr` strings move from local `index.ts` files into a Postgres `field_mapping` table.
2. **Zero-Deploy Customization**: Customers or admins can write a custom JSONata expression in the Nexiom UI ("Custom Field Mapper").
3. **Instant Rollout**: The UI saves the new JSONata string to Postgres. The `NormalizationWorker` cache invalidates, pulls the new string, recompiles the AST, and immediately begins transforming new events.

By adopting this strategy locally now, the underlying CDC pipeline and Normalize worker will never need to be rewritten when Nexiom launches dynamic mapping in the UI.
