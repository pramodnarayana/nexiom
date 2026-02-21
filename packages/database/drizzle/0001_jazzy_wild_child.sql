CREATE TYPE "public"."connection_status_enum" AS ENUM('ACTIVE', 'INACTIVE', 'REVOKED', 'EXPIRED');--> statement-breakpoint
DROP INDEX "status_idx";--> statement-breakpoint
/* 
    Unfortunately in current drizzle-kit version we can't automatically get name for primary key.
    We are working on making it available!

    Meanwhile you can:
        1. Check pk name in your database, by running
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_schema = 'public'
                AND table_name = 'provider'
                AND constraint_type = 'PRIMARY KEY';
        2. Uncomment code below and paste pk name manually
        
    Hope to release this update as soon as possible
*/

-- ALTER TABLE "provider" DROP CONSTRAINT "<constraint_name>";--> statement-breakpoint
ALTER TABLE "app_connection" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"public"."connection_status_enum";--> statement-breakpoint
ALTER TABLE "app_connection" ALTER COLUMN "status" SET DATA TYPE "public"."connection_status_enum" USING "status"::"public"."connection_status_enum";--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "app_connection" ADD COLUMN "provider_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "app_connection" ADD CONSTRAINT "app_connection_provider_id_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "provider" ADD CONSTRAINT "provider_name_unique" UNIQUE("name");--> statement-breakpoint
ALTER TABLE "provider" ADD CONSTRAINT "oauth_check" CHECK (auth_type != 'OAUTH2' OR (authorize_url IS NOT NULL AND token_url IS NOT NULL));