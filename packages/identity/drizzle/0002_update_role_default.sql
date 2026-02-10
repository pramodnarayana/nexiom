-- Migration: Update user role default from 'user' to 'member'
-- Aligns schema with unified role naming system

ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'member';
