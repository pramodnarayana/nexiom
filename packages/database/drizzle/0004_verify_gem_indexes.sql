-- ============================================================
-- GATE MIGRATION: Verify out-of-band GEM indexes are present
-- ============================================================
-- This migration intentionally fails unless both gem_source_app_idx
-- and gem_dest_app_idx have been applied via CREATE INDEX CONCURRENTLY
-- (see 0003_add_gem_indexes.sql for instructions).
--
-- If this migration fails during deployment it means the out-of-band
-- index step was skipped. Run the CONCURRENTLY commands from 0003 first,
-- then re-run db:migrate.
-- ============================================================
DO $$
DECLARE
  missing TEXT := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE indexname = 'gem_source_app_idx'
       AND tablename = 'global_entity_map'
  ) THEN
    missing := missing || ' gem_source_app_idx';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE indexname = 'gem_dest_app_idx'
       AND tablename = 'global_entity_map'
  ) THEN
    missing := missing || ' gem_dest_app_idx';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION
      'Deployment blocked: out-of-band index(es) missing on global_entity_map: [%]. '
      'Run CREATE INDEX CONCURRENTLY for each missing index (see 0003_add_gem_indexes.sql) '
      'then re-run db:migrate.',
      TRIM(missing);
  END IF;
END $$;
