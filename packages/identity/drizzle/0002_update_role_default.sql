-- Migration: Update user role default from 'user' to 'member'
-- Aligns schema with unified role naming system

-- Step 1: Backfill existing rows (update any 'user' roles to 'member')
UPDATE "user" SET "role" = 'member' WHERE "role" = 'user';

-- Step 2: Set new default for future inserts
ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'member';
