ALTER TABLE "organization" ADD COLUMN "updatedAt" timestamp;
UPDATE "organization" SET "updatedAt" = COALESCE("createdAt", now()) WHERE "updatedAt" IS NULL;
ALTER TABLE "organization" ALTER COLUMN "updatedAt" SET DEFAULT now();
ALTER TABLE "organization" ALTER COLUMN "updatedAt" SET NOT NULL;