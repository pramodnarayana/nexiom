CREATE TABLE "ui_workspace_data_source" (
	"workspace_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ui_workspace_data_source_workspace_id_data_source_id_pk" PRIMARY KEY("workspace_id","data_source_id")
);
--> statement-breakpoint
ALTER TABLE "ui_workspace_data_source" ADD CONSTRAINT "ui_workspace_data_source_workspace_id_ui_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."ui_workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_workspace_data_source" ADD CONSTRAINT "ui_workspace_data_source_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_data_source_ds_idx" ON "ui_workspace_data_source" USING btree ("data_source_id");