-- ============================================================
-- GATE MIGRATION: Verify out-of-band GEM indexes are present and usable
-- ============================================================
-- This migration intentionally fails unless both gem_source_app_idx
-- and gem_dest_app_idx have been applied via CREATE INDEX CONCURRENTLY
-- (see 0003_add_gem_indexes.sql for instructions) AND are fully valid
-- (indisvalid = true, indisready = true).
--
-- A stub left by an interrupted CONCURRENTLY run will have indisvalid=false
-- or indisready=false and must be dropped and rebuilt before this gate passes.
--
-- If this migration fails during deployment it means the out-of-band
-- index step was skipped or failed midway. Run the CONCURRENTLY commands
-- from 0003 first (dropping any invalid stubs with DROP INDEX CONCURRENTLY),
-- then re-run db:migrate.
-- ============================================================
DO $$
DECLARE
  missing TEXT := '';
BEGIN
  -- Check gem_source_app_idx exists, is valid, and is ready.
  -- Join pg_class → pg_index to avoid treating unusable stubs as present.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class      c
      JOIN pg_index      i ON i.indexrelid = c.oid
      JOIN pg_class      t ON t.oid        = i.indrelid
     WHERE c.relname = 'gem_source_app_idx'
       AND t.relname = 'global_entity_map'
       AND i.indisvalid  = true
       AND i.indisready  = true
  ) THEN
    missing := missing || ' gem_source_app_idx';
  END IF;

  -- Check gem_dest_app_idx exists, is valid, and is ready.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class      c
      JOIN pg_index      i ON i.indexrelid = c.oid
      JOIN pg_class      t ON t.oid        = i.indrelid
     WHERE c.relname = 'gem_dest_app_idx'
       AND t.relname = 'global_entity_map'
       AND i.indisvalid  = true
       AND i.indisready  = true
  ) THEN
    missing := missing || ' gem_dest_app_idx';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION
      'Deployment blocked: missing or unusable index(es) on global_entity_map: [%]. '
      'Ensure CREATE INDEX CONCURRENTLY completed successfully for each '
      '(drop any invalid stubs first, then re-run). See 0003_add_gem_indexes.sql.',
      TRIM(missing);
  END IF;
END $$;

