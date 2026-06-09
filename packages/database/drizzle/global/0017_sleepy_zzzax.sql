CREATE TABLE "workspace_pieces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"piece_id" uuid NOT NULL,
	"installed_version" varchar(50),
	"status" varchar(50) DEFAULT 'INSTALLING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_pieces_workspace_id_piece_id_unique" UNIQUE("workspace_id", "piece_id"),
	CONSTRAINT "workspace_pieces_status_check" CHECK ("status" IN ('INSTALLING', 'INSTALLED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "workspace_pieces" ADD CONSTRAINT "workspace_pieces_workspace_id_ui_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."ui_workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_pieces" ADD CONSTRAINT "workspace_pieces_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE cascade ON UPDATE no action;