<!-- markdownlint-disable MD060 -->
# Engine Platform — Execution Kernel

Generic execution machinery. **Zero knowledge of specific vendors or business
rules.** This code could theoretically power the sync of any two structured
systems — it only knows *how* to execute, not *what* to sync.

## Sub-packages (current and planned)

| Directory | Package | Status | Description |
|:---|:---|:---|:---|
| `core/compositor/` | `@nexiom/engine` | Migrating (T055 Ph1) | Assembles `root_trace_id` rows into Canonical Composite JSON (Fat Object) |
| `core/evaluator/` | `@nexiom/engine` | Migrating (T055 Ph1) | Evaluates Sync Conditions (filters) — `evaluateConditions()` |
| `core/enricher/` | `@nexiom/engine` | Migrating (T055 Ph1) | Detects missing parent entities, triggers L5 fetch to resolve graph gaps |
| `core/cursor-manager/` | `@nexiom/engine` | Migrating (T055 Ph1) | Singer-style incremental cursor state |
| `core/storage-resolver/` | `@nexiom/engine` | Migrating (T055 Ph1) | Tenant silo routing — `ws_{id}` schema selection |
| `core/formula-registry/` | `@nexiom/engine` | Migrating (T055 Ph1) | Generic formula execution contract (registry + runner) |
| `core/path-utils/` | `@nexiom/engine` | Migrating (T055 Ph1) | Proto-safe `getNestedValue` / `setNestedValue` |
| `piece-framework/` | `@nexiom/piece-framework` | Migrating (T055 Ph2) | Generic `Piece`/`Action`/`Trigger`/`Poll` contracts |

## What belongs here

- Generic JSON path traversal utilities
- State machine primitives (cursor management)
- Rule/condition evaluation (generic predicate engine)
- Composite assembly (given a `root_trace_id`, group and nest rows — no domain knowledge)
- Storage/silo routing (tenant schema selection — generic multi-tenant pattern)
- Piece contract interfaces (`Piece`, `Action`, `Trigger`) — interfaces only, no vendor code

## What does NOT belong here

- Any vendor name (`salesforce`, `quickbooks`)
- Any Nexiom domain concept (`StitchConfig`, `MappingRule`, `canonical`, vendor parsers)
- Any business rule (tax code logic, currency override, etc.)

Those belong in `engine/application/`.
