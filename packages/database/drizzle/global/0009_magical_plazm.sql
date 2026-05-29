CREATE TABLE "connector_object_profiles" (
	"data_source_id" uuid NOT NULL,
	"object_name" varchar(255) NOT NULL,
	"profile" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_object_profiles_data_source_id_object_name_pk" PRIMARY KEY("data_source_id","object_name")
);
--> statement-breakpoint
ALTER TABLE "connector_object_profiles" ADD CONSTRAINT "connector_object_profiles_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;