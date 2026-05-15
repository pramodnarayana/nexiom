CREATE TYPE "public"."registry_outbox_action_enum" AS ENUM('UPSERT', 'DELETE');--> statement-breakpoint
CREATE TYPE "public"."registry_outbox_entity_enum" AS ENUM('APP_CONNECTION', 'INTEGRATION_STITCH', 'FIELD_MAPPING');--> statement-breakpoint
CREATE TYPE "public"."registry_outbox_status_enum" AS ENUM('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TABLE "global_registry_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(255) NOT NULL,
	"entity_type" "registry_outbox_entity_enum" NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" "registry_outbox_action_enum" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "registry_outbox_status_enum" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "registry_outbox_poll_idx" ON "global_registry_outbox" USING btree ("next_retry_at") WHERE status = 'PENDING' OR status = 'FAILED';--> statement-breakpoint
CREATE INDEX "registry_outbox_tenant_idx" ON "global_registry_outbox" USING btree ("tenant_id");