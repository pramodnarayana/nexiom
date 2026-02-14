ALTER TABLE "organization" DROP CONSTRAINT "organization_slug_unique";--> statement-breakpoint
ALTER TABLE "session" DROP CONSTRAINT "session_impersonatedBy_user_id_fk";
--> statement-breakpoint
DROP INDEX "member_null_org_user_idx";--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_impersonatedBy_user_id_fk" FOREIGN KEY ("impersonatedBy") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_unique_idx" ON "organization" USING btree ("slug") WHERE "deletedAt" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "member_null_org_user_idx" ON "member" USING btree ("userId",COALESCE("organizationId", '__NULL__')) WHERE "deletedAt" IS NULL;