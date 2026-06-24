CREATE TABLE "tms_address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"replica_id" uuid NOT NULL,
	"data_source_id" varchar(255) NOT NULL,
	"source_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"display_name" varchar(255),
	"tms_type" varchar(100),
	"billing_street" varchar(500),
	"billing_city" varchar(100),
	"billing_state" varchar(100),
	"billing_postal_code" varchar(20),
	"billing_country" varchar(100),
	"phone" varchar(50),
	"fax" varchar(50),
	"email" varchar(255),
	"is_pickup" text,
	"is_delivery" text
);
--> statement-breakpoint
CREATE TABLE "tms_carrier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"replica_id" uuid NOT NULL,
	"data_source_id" varchar(255) NOT NULL,
	"source_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"display_name" varchar(255),
	"tms_type" varchar(100),
	"billing_street" varchar(500),
	"billing_city" varchar(100),
	"billing_state" varchar(100),
	"billing_postal_code" varchar(20),
	"billing_country" varchar(100),
	"phone" varchar(50),
	"fax" varchar(50),
	"email" varchar(255),
	"tp_source_id" varchar(255),
	"remit_to_source_id" varchar(255),
	"is_carrier" text,
	"is_broker" text
);
--> statement-breakpoint
CREATE TABLE "tms_customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"replica_id" uuid NOT NULL,
	"data_source_id" varchar(255) NOT NULL,
	"source_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"display_name" varchar(255),
	"tms_type" varchar(100),
	"billing_street" varchar(500),
	"billing_city" varchar(100),
	"billing_state" varchar(100),
	"billing_postal_code" varchar(20),
	"billing_country" varchar(100),
	"phone" varchar(50),
	"fax" varchar(50),
	"email" varchar(255),
	"credit_limit" varchar(50),
	"payment_terms" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "tms_factoring" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"replica_id" uuid NOT NULL,
	"data_source_id" varchar(255) NOT NULL,
	"source_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"display_name" varchar(255),
	"tms_type" varchar(100),
	"billing_street" varchar(500),
	"billing_city" varchar(100),
	"billing_state" varchar(100),
	"billing_postal_code" varchar(20),
	"billing_country" varchar(100),
	"phone" varchar(50),
	"fax" varchar(50),
	"email" varchar(255),
	"payment_terms" varchar(100),
	"mc_number" varchar(50),
	"us_dot_number" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "tms_tp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"replica_id" uuid NOT NULL,
	"data_source_id" varchar(255) NOT NULL,
	"source_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_terms" varchar(100),
	"payment_terms" varchar(100),
	"carrier_payment_terms" varchar(100),
	"carrier_remit_to" varchar(255),
	"company_type" varchar(100),
	"credit_limit" varchar(50),
	"remit_to_option" varchar(100),
	"mc_number" varchar(50),
	"state_dot_number" varchar(50),
	"us_dot_number" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "tms_vendor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"replica_id" uuid NOT NULL,
	"data_source_id" varchar(255) NOT NULL,
	"source_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"display_name" varchar(255),
	"tms_type" varchar(100),
	"billing_street" varchar(500),
	"billing_city" varchar(100),
	"billing_state" varchar(100),
	"billing_postal_code" varchar(20),
	"billing_country" varchar(100),
	"phone" varchar(50),
	"fax" varchar(50),
	"email" varchar(255),
	"tp_source_id" varchar(255),
	"is_vendor" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tms_address_composite" ON "tms_address" USING btree ("data_source_id","source_id");--> statement-breakpoint
CREATE INDEX "idx_tms_address_trace" ON "tms_address" USING btree ("trace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tms_carrier_composite" ON "tms_carrier" USING btree ("data_source_id","source_id");--> statement-breakpoint
CREATE INDEX "idx_tms_carrier_tp" ON "tms_carrier" USING btree ("tp_source_id") WHERE "tms_carrier"."tp_source_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_tms_carrier_trace" ON "tms_carrier" USING btree ("trace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tms_customer_composite" ON "tms_customer" USING btree ("data_source_id","source_id");--> statement-breakpoint
CREATE INDEX "idx_tms_customer_trace" ON "tms_customer" USING btree ("trace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tms_factoring_composite" ON "tms_factoring" USING btree ("data_source_id","source_id");--> statement-breakpoint
CREATE INDEX "idx_tms_factoring_trace" ON "tms_factoring" USING btree ("trace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tms_tp_composite" ON "tms_tp" USING btree ("data_source_id","source_id");--> statement-breakpoint
CREATE INDEX "idx_tms_tp_remit_to" ON "tms_tp" USING btree ("carrier_remit_to") WHERE "tms_tp"."carrier_remit_to" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_tms_tp_trace" ON "tms_tp" USING btree ("trace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tms_vendor_composite" ON "tms_vendor" USING btree ("data_source_id","source_id");--> statement-breakpoint
CREATE INDEX "idx_tms_vendor_tp" ON "tms_vendor" USING btree ("tp_source_id") WHERE "tms_vendor"."tp_source_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_tms_vendor_trace" ON "tms_vendor" USING btree ("trace_id");