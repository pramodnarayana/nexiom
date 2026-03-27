# Migration Baseline Strategy

**Date:** 2026-03-27
**Baseline Tag:** `0000_salty_stryfe` (configured in `_journal.json`)

## Context

As part of the database centralization initiative, all schemas and migrations were consolidated into `@nexiom/database`. The migration baseline tag has been updated to `0000_salty_stryfe`.

## Strategy

Because this modifies the baseline tag, operators of existing deployments will need to reconcile the local `__drizzle_migrations` table to prevent Drizzle from attempting to re-apply the baseline schema.

### Reconciling Existing Environments

If applying to an existing deployment that has already run migrations under the old `apps/api` baseline, follow these steps before normal rollout:

1. **Verify Existing Schema:** Ensure the environment's database has the baseline tables.
2. **Backfill Migration Record:** Insert a fake log marking the new tag as applied to prevent conflicts:

   ```sql
   INSERT INTO __drizzle_migrations (id, hash, created_at)
   VALUES (0, '0000_salty_stryfe', extract(epoch from now()) * 1000);
   ```

3. **Rollout:** Run the standard `pnpm db:migrate` going forward.
