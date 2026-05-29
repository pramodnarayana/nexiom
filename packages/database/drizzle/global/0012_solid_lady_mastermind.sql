ALTER TABLE "scheduler_outbox" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "scheduler_outbox" CASCADE;--> statement-breakpoint
ALTER TABLE "integration_stitch" DROP CONSTRAINT "sync_interval_minutes_positive";--> statement-breakpoint
ALTER TABLE "data_source" ADD COLUMN "sync_interval_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "data_source" ADD COLUMN "schedule_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "data_source" ADD COLUMN "last_scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_stitch" DROP COLUMN "sync_interval_minutes";--> statement-breakpoint
ALTER TABLE "integration_stitch" DROP COLUMN "schedule_enabled";--> statement-breakpoint
ALTER TABLE "integration_stitch" DROP COLUMN "last_scheduled_at";--> statement-breakpoint
DROP TYPE "public"."scheduler_outbox_action_enum";--> statement-breakpoint
DROP TYPE "public"."scheduler_outbox_status_enum";