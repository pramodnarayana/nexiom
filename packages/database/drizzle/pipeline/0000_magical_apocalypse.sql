CREATE TYPE "pipeline_layer_enum" AS ENUM('L1', 'L2', 'L3', 'L4', 'L5', 'L6');--> statement-breakpoint
CREATE TYPE "pipeline_status_enum" AS ENUM('RECEIVED', 'PROCESSING', 'REPLICATED', 'NORMALIZED', 'SKIPPED', 'PENDING', 'SUCCESS', 'FAIL', 'RETRY', 'DISMISSED', 'DEFERRED_DEPENDENCY');--> statement-breakpoint
CREATE TABLE "active_sync_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"locked_by_trace_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_gateway" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"object_type" varchar(100),
	"request" jsonb NOT NULL,
	"response" jsonb,
	"headers" jsonb,
	"ext_req_id" varchar(255),
	"status" "pipeline_status_enum" DEFAULT 'RECEIVED' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_gateway_trace_id_unique" UNIQUE("trace_id")
);
--> statement-breakpoint
CREATE TABLE "inbound_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"schema_name" varchar(128) DEFAULT current_schema() NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" varchar(500),
	"claim_token" varchar(36),
	"next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "normalized_entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"replica_id" uuid NOT NULL,
	"canonical_type" varchar(100) NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "normalized_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"schema_name" varchar(128) DEFAULT current_schema() NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" varchar(500),
	"next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_gateway" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"src_data_source_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"response" jsonb,
	"status_code" integer,
	"dest_vendor_id" varchar(255),
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbound_gateway_id" uuid NOT NULL,
	"trace_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"src_data_source_id" uuid NOT NULL,
	"dest_data_source_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" varchar(500),
	"next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replica_entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"trace_id" uuid NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"data" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replica_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"schema_name" varchar(128) DEFAULT current_schema() NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" varchar(500),
	"next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_cursor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"last_sync_timestamp" varchar(255) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"route_id" uuid,
	"layer" "pipeline_layer_enum" NOT NULL,
	"status" "pipeline_status_enum" NOT NULL,
	"duration_ms" integer,
	"error_message" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sync_lock_unique" ON "active_sync_locks" USING btree ("data_source_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_l1_ext_id" ON "inbound_gateway" USING btree ("data_source_id","ext_req_id");--> statement-breakpoint
CREATE INDEX "idx_l1_object_type" ON "inbound_gateway" USING btree ("object_type");--> statement-breakpoint
CREATE INDEX "idx_l1_status" ON "inbound_gateway" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_l1_request_gin" ON "inbound_gateway" USING gin ("request");--> statement-breakpoint
CREATE INDEX "idx_inbound_outbox_claim" ON "inbound_outbox" USING btree ("status","next_retry_at") WHERE status IN ('PENDING', 'PROCESSING', 'RETRY');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_inbound_outbox_trace" ON "inbound_outbox" USING btree ("trace_id","data_source_id");--> statement-breakpoint
CREATE INDEX "idx_l3_trace" ON "normalized_entity" USING btree ("trace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_l3_replica" ON "normalized_entity" USING btree ("replica_id");--> statement-breakpoint
CREATE INDEX "idx_l3_canonical_type" ON "normalized_entity" USING btree ("canonical_type");--> statement-breakpoint
CREATE INDEX "idx_l3_data_gin" ON "normalized_entity" USING gin ("data");--> statement-breakpoint
CREATE INDEX "idx_normalized_outbox_claim" ON "normalized_outbox" USING btree ("status","next_retry_at") WHERE status IN ('PENDING', 'PROCESSING', 'RETRY');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_normalized_outbox_trace" ON "normalized_outbox" USING btree ("trace_id","data_source_id");--> statement-breakpoint
CREATE INDEX "idx_l6_trace" ON "outbound_gateway" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "idx_l6_route" ON "outbound_gateway" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "idx_l6_status" ON "outbound_gateway" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_l6_trace_route" ON "outbound_gateway" USING btree ("trace_id","route_id");--> statement-breakpoint
CREATE INDEX "idx_outbound_outbox_claim" ON "outbound_outbox" USING btree ("status","next_retry_at") WHERE status IN ('PENDING', 'PROCESSING', 'RETRY');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_l2_unique_entity" ON "replica_entity" USING btree ("data_source_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_l2_trace" ON "replica_entity" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "idx_l2_data_gin" ON "replica_entity" USING gin ("data");--> statement-breakpoint
CREATE INDEX "idx_replica_outbox_claim" ON "replica_outbox" USING btree ("status","next_retry_at") WHERE status IN ('PENDING', 'PROCESSING', 'RETRY');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_replica_outbox_trace" ON "replica_outbox" USING btree ("trace_id","data_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_cursor" ON "sync_cursor" USING btree ("data_source_id","entity_type");--> statement-breakpoint
CREATE INDEX "idx_log_trace" ON "sync_log" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "idx_log_route" ON "sync_log" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "idx_log_layer" ON "sync_log" USING btree ("trace_id","layer");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_log_routed" ON "sync_log" USING btree ("trace_id","route_id","layer","status") WHERE "sync_log"."route_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_log_unrouted" ON "sync_log" USING btree ("trace_id","layer","status") WHERE "sync_log"."route_id" IS NULL;