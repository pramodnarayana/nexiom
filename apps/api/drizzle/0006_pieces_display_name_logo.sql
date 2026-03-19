-- Migration: Add display_name (NOT NULL), logo_url, and updated_at to pieces.
--
-- Safe three-phase approach for display_name to avoid locking issues on
-- tables that may already have seeded rows:
--   Phase 1 — Add column as nullable (no default, no lock escalation).
--   Phase 2 — Backfill known seeded rows with canonical names; fall back to
--              initcap(name) for any unrecognised rows added between migrations.
--   Phase 3 — Alter to NOT NULL once every row has a value.
--
-- logo_url and updated_at are added separately as nullable/defaulted columns
-- (no backfill required).
--
-- Reversible: DOWN section reverts all three columns.

-- UP — Phase 1: add nullable column (no table rewrite, no lock) -------------
DO $$ BEGIN
  ALTER TABLE "pieces" ADD COLUMN "display_name" varchar(255);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
--> statement-breakpoint

-- UP — Phase 2: backfill known seeded pieces first, then generic fallback ----
UPDATE "pieces" SET "display_name" = 'Salesforce'          WHERE "name" = 'salesforce' AND "display_name" IS NULL;
--> statement-breakpoint
UPDATE "pieces" SET "display_name" = 'QuickBooks Online'   WHERE "name" = 'quickbooks' AND "display_name" IS NULL;
--> statement-breakpoint
-- Generic fallback: title-case the internal name for any row not yet filled
UPDATE "pieces" SET "display_name" = initcap("name") WHERE "display_name" IS NULL;
--> statement-breakpoint

-- UP — Phase 3: harden to NOT NULL once every row has a value ----------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'pieces'
      AND column_name  = 'display_name'
      AND is_nullable  = 'YES'
  ) THEN
    ALTER TABLE "pieces" ALTER COLUMN "display_name" SET NOT NULL;
  END IF;
END $$;
--> statement-breakpoint

-- logo_url — nullable by design; no backfill needed -------------------------
DO $$ BEGIN
  ALTER TABLE "pieces" ADD COLUMN "logo_url" varchar(1024);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
--> statement-breakpoint

-- updated_at — safe default covers all existing rows atomically --------------
DO $$ BEGIN
  ALTER TABLE "pieces" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- DOWN -----------------------------------------------------------------------
-- ALTER TABLE "pieces" DROP COLUMN "updated_at";
-- ALTER TABLE "pieces" DROP COLUMN "logo_url";
-- ALTER TABLE "pieces" DROP COLUMN "display_name";
