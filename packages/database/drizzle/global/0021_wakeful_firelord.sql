ALTER TABLE "pieces" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN "categories" jsonb;--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN "auth_type" varchar(100);--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN "auth_schema" jsonb;--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN "aliases" jsonb;