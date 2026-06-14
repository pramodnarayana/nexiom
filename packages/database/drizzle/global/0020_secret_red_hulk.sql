DROP INDEX "registry_outbox_poll_idx";--> statement-breakpoint
CREATE INDEX "registry_outbox_poll_idx" ON "global_registry_outbox" USING btree ("next_retry_at") WHERE status = 'PENDING' OR status = 'RETRY';--> statement-breakpoint
ALTER TABLE "global_registry_outbox" ADD CONSTRAINT "registry_outbox_status_check" CHECK (status IN ('PENDING', 'RETRY', 'FAIL', 'SUCCESS', 'PROCESSING'));