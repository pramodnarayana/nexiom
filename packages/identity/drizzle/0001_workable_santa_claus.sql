ALTER TABLE "member" DROP CONSTRAINT "member_organizationId_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "isSystem" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "role_permission" ADD COLUMN "organizationId" text;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;