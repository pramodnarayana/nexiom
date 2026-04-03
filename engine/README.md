# Nexiom Sync Engine

> **This is Nexiom's core IP.** Handle with care.

The Sync Engine is the product — the code that makes Nexiom valuable. It is
responsible for moving data reliably between any two structured systems
through the 6-layer pipeline (L1 Ingestor → L6 Closer).

See [`docs/architecture/sync_strategy/sync_strategy.md`](../docs/architecture/sync_strategy/sync_strategy.md)
for the full architectural specification.

---

## Structure

```
engine/
├── platform/      HOW sync works — generic execution machinery
│                  Zero knowledge of specific vendors or business rules.
│                  Could theoretically sync any two structured systems.
│
└── application/   WHAT gets synced — integration domain logic
                   Vendor-aware. Business-rule-aware.
                   Imports from engine/platform/ and packages/.
```

## Dependency Rule

```
packages/  (infrastructure)
    ▲
engine/platform/  — never imports from engine/application/
    ▲
engine/application/  — imports from engine/platform/ + packages/
    ▲
apps/  — imports from engine/ + packages/
```

Enforced via `eslint-plugin-import/no-restricted-paths`.

## Adding New Code

- **Generic execution logic** (path utils, state machines, rule evaluators)
  → `engine/platform/`

- **Vendor implementations, field mapping, canonical models**
  → `engine/application/`

- **Infrastructure** (queue, database, cache, auth)
  → `packages/` — **not here**

## Migration Status

Four legacy packages are migrating into `engine/` via **T055**:

| Source | Target | Task |
|:---|:---|:---|
| `packages/engine/` | `engine/platform/core/` | T055 Phase 1 |
| `packages/piece-framework/` | `engine/platform/piece-framework/` | T055 Phase 2 |
| `packages/connectors/` | `engine/application/connectors/` | T055 Phase 3 |
| `packages/pieces/` | `engine/application/pieces/` | T055 Phase 3 |

All **net-new** engine code goes directly into `engine/` — never into `packages/`.
