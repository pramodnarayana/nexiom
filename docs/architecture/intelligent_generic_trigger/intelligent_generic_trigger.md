# Strategy: Transitioning to 100% Intelligent Generic Triggers

Moving away from hardcoded triggers (like `new-contact.ts`) to a single, universal `generic-record-trigger.ts` is the architectural pinnacle of iPaaS engineering. It reduces maintenance overhead by 90% and ensures instant compatibility with any SaaS configuration.

## 1. Is a 100% Generic Model "Enterprise Grade"?

Yes, provided it is "Intelligent." A basic generic trigger often fails enterprise requirements because it treats all objects the same, leading to API rate-limit exhaustion or missed data (e.g., failing to fetch child records). To be enterprise-grade, the generic engine must use Object Metadata Hints.

### The Evolution of Triggers

| Feature | Hardcoded Triggers | "Dumb" Generic Trigger | Intelligent Generic Engine |
| --- | --- | --- | --- |
| Maintenance | High (500+ files) | Low (1 file) | Low (1 file + Config) |
| API Efficiency | Optimized per object | Poor (Standard Polling) | High (Uses best API for type) |
| Data Integrity | High (Custom Logic) | Moderate (Missing Joins) | High (Metadata Joins) |
| Onboarding | Instant (Pre-built) | Slow (Manual Config) | Instant (Self-Configuring) |

## 2. Requirements for an Enterprise Generic Engine

To replace specialized code, the generic engine must implement the following three "Smart" capabilities:

### A. Optimization Overrides (The Hint System)

The engine reads a central configuration or queries the API metadata to decide how to fetch the data.

- **If Object is "Contact":** The engine sees a "Hint" to use the Salesforce Change Data Capture (CDC) stream instead of polling.
- **If Object is "Big_Custom_Object__c":** The engine detects high volume and automatically switches to the Bulk API 2.0 for ingestion.

### B. Dynamic Relationship Hydration (The "Auto-Join")

Enterprise data is rarely flat. A specialized trigger for an "Invoice" usually fetches the "Line Items" too. A generic trigger must discover these relationships.

- **Mechanism:** The engine inspects the object's ChildRelationships metadata.
- **Action:** It dynamically appends sub-queries (e.g., `SELECT Id, (SELECT Amount FROM LineItems) FROM Invoice`) based on the user's mapping needs.

### C. Polymorphic Cursor Management

Different objects have different "truth" markers.

- **Standard:** `LastModifiedDate`.
- **High-Volume:** `SystemModstamp`.
- **Append-Only:** AutoNumber or ID.

The generic engine must test the object's schema to determine the most reliable high-water mark (cursor) automatically.

## 3. Implementation Blueprint

Instead of 500 files, we move to a Core Registry + Unified Runner:

```typescript
// packages/connections/src/intelligence/optimization-registry.ts
export const SalesforceObjectHacks = {
  'Contact': { preferApi: 'CDC', defaultFields: ['Email', 'AccountId'] },
  'Invoice': { autoJoinChildren: ['LineItems'], cursor: 'SystemModstamp' }
};

// packages/pieces/salesforce/src/lib/trigger/universal-trigger.ts
export const salesforceUniversalTrigger = createTrigger({
  name: 'universal_trigger',
  async run(context) {
    const { objectName, auth } = context;
    const hacks = SalesforceObjectHacks[objectName] || {};

    // 1. Build Query using hacks + standard discovery
    const query = buildSmartSoql(objectName, hacks);
    
    // 2. Execute via the most efficient API path detected
    return await executeViaOptimalPath(auth, query, hacks.preferApi);
  }
});
```

## 4. Final Verdict & Roadmap

**Should we move everything to a Generic Trigger?**
Yes. Maintaining specialized files for every standard object is a "Technical Debt Trap." As Salesforce or QuickBooks update their APIs, you don't want to update 50 files.

### The Recommended Transition Path

- **Phase 1 (Current):** Use specialized files for the "Top 10" objects to ensure perfect UX and performance during launch. Use "Dumb" Generic triggers for everything else.
- **Phase 2:** Build the Intelligent Generic Engine (Metadata hints + relationship discovery).
- **Phase 3:** Delete the specialized files. The "Top 10" objects now run through the Generic Engine using optimization hints, making them indistinguishable from the old specialized code but significantly easier to maintain.

**Conclusion:** 100% Generic is the hallmark of a mature, enterprise-grade iPaaS. It proves that your platform is a Runtime rather than just a collection of scripts.
