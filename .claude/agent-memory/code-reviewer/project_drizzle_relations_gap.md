---
name: appConnections missing Drizzle relations
description: appConnections table in packages/database/src/schema/tenant.ts has no relations() defined, making db.query.appConnections.findMany() unreliable and prone to leaking all columns including encrypted value
type: project
---

The `appConnections` table defined in `packages/database/src/schema/tenant.ts` does not have a corresponding `relations(appConnections, ...)` call anywhere in the database package.

**Why:** Drizzle's relational query API (`db.query.<table>.findMany()`) depends on relations being registered. Without them, queries may still execute (returning SELECT *), but this leaks sensitive columns like `value` (encrypted credentials blob) to callers who expect only safe fields.

**How to apply:** Any code using `db.query.appConnections.findMany()` or `.findFirst()` should be flagged. Prefer explicit `.select({...}).from(appConnections)` calls until relations are defined. Found in `WorkspacesService.listAvailableConnections` (2026-03-21).
