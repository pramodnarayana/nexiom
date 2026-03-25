-- Migration: Upgrade scheduler_outbox poll index to a partial index (S1).
--
-- The composite index on (status, next_retry_at) scans all rows including
-- the large succeeded/failed population.  A partial index covering only
-- pending rows is much smaller and keeps the poll query fast at scale.
--
-- The poll query shape: WHERE status = 'pending' AND next_retry_at <= NOW()
-- ORDER BY next_retry_at ASC LIMIT N FOR UPDATE SKIP LOCKED

-- Drop old composite index if it exists (created by schema push in earlier envs).
DROP INDEX IF EXISTS "scheduler_outbox_poll_idx";
--> statement-breakpoint

-- Partial index: only pending rows, ordered by earliest retry time.
CREATE INDEX IF NOT EXISTS "scheduler_outbox_poll_idx"
  ON "scheduler_outbox" ("next_retry_at" ASC)
  WHERE status = 'pending';
