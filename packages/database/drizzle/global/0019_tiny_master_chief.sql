DROP INDEX "registry_outbox_poll_idx";--> statement-breakpoint
-- Normalize legacy enum values to new runtime vocabulary before type conversion
UPDATE "global_registry_outbox" SET "status" = 'FAIL' WHERE "status" = 'FAILED';--> statement-breakpoint
ALTER TABLE "global_registry_outbox" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
ALTER TABLE "global_registry_outbox" ALTER COLUMN "status" SET DEFAULT 'PENDING';--> statement-breakpoint
CREATE INDEX "registry_outbox_poll_idx" ON "global_registry_outbox" USING btree ("next_retry_at") WHERE status = 'PENDING' OR status = 'RETRY';--> statement-breakpoint
DROP TYPE "public"."registry_outbox_status_enum";