# Architecture: Scalable Custom Logic Management

This document defines the strategy for handling customer-specific business logic (custom transformations, specialized filters, or legacy API parsers) using a **Fleet Sharded Git** model.

## 1. The Core Strategy: Fleet Sharding

We do not create a repository for every customer. Instead, we group customers into **Repository Shards**. This balances management overhead with Git performance.

### A. The Sharding Model

- **The Shard:** A single Git repository (e.g., `fluxnex-shard-001`) that houses the logic for 500 to 1,000 organizations.
- **The Registry:** The `public.organization` table stores a `git_shard_id`, telling the engine which repo contains that customer's custom files.

### B. Directory Structure (Within a Shard)

To prevent filesystem performance issues, we use **Prefix Sharding** inside the repository:

```
/fluxnex-shard-001
└── /shards
    └── /en (Prefix)
        └── /envoy-logistics (Tenant ID)
            ├── /l3-normalization        # Custom Canonical logic
            ├── /l4-transformation       # Custom mapping functions
            └── config.json              # Tenant-specific overrides
```

## 2. Technical Implementation: The "Custom Logic" Hook

The 6-layer pipeline is updated with **Extension Points**. If a custom script exists for a tenant at a specific layer, the engine executes it; otherwise, it falls back to the generic logic.

### A. The Execution Pattern (Pseudo-code)

```typescript
// packages/engine/src/executor/logic-resolver.ts
async function executeLayer(tenantId: string, layer: string, data: any) {
  // 1. Check if this tenant has a custom override in their local directory
  const customPath = getCustomScriptPath(tenantId, layer);

  if (fs.existsSync(customPath)) {
    // 2. Execute custom customer logic
    const customModule = require(customPath);
    return await customModule.run(data);
  }

  // 3. Fallback to Platform Generic logic
  return await genericHandler.run(data);
}
```

## 3. The Management Workflow (Support & Devs)

When a customer needs a custom "Load-to-Invoice" transformation that the standard UI cannot handle:

1. **Authoring:** A FluxNex support engineer writes a small TypeScript file: `transform.ts`.
2. **Sandbox Test:** They upload the file to the Sandbox Workspace via the UI or CLI.
3. **Git Check-in:** The system's GitOps Agent automatically commits the file to `shard-001` under the customer's directory.
4. **Promotion:** Once verified in Sandbox, the engineer "Promotes" the logic. The GitOps Agent tags the commit and mirrors the file to the Production cluster's local disk (or S3).

## 4. Scaling & Security Boundaries

### A. Performance (Pre-loading)

To avoid high-latency disk reads during a sync, the worker nodes **Sync & Cache** the Git shards.

- Workers perform a `git pull` on the shards they are responsible for every 5 minutes.
- Scripts are loaded into memory and cached.

### B. Security (The Sandbox)

Because this is custom code, we execute it using a **Node.js VM Sandbox** (e.g., `isolated-vm` or `vm2`). This ensures:

- A customer's custom script cannot access `process.env`.
- It cannot perform unauthorized network calls.
- It cannot read files from the core platform directories.

## 5. Comparison: Why this is the "Enterprise Winner"

| Feature | Repo-per-Customer | Single Giant Repo | Fleet Sharding (FluxNex) |
|---|---|---|---|
| Scalability | ❌ 10,000 repos is unmanageable. | ❌ Git slows to a crawl. | ✅ Distributed and fast. |
| Searchability | ❌ Hard to grep across all. | ✅ Easy. | ✅ Balanced (grep across shards). |
| Isolation | ✅ High. | ❌ Low (Risk of cross-edit). | ✅ High (Per-folder permissions). |
| CI/CD | ❌ Brittle. | ❌ Single point of failure. | ✅ Resilient & Parallelizable. |

## 6. Summary Verdict

The Fleet Sharding model allows FluxNex to offer "White Glove" custom engineering for high-value enterprise customers while maintaining the operational simplicity of a SaaS. It treats custom logic as **Metadata-as-Code**, ensuring that the "Memory of the Customer" is preserved in Git without bloating the platform's core engine.
