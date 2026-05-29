ALTER TABLE "integration_stitch" RENAME COLUMN "source_object" TO "canonical_object";--> statement-breakpoint
ALTER TABLE "integration_stitch" DROP CONSTRAINT "stitch_src_data_source_fk";
--> statement-breakpoint
DROP INDEX "stitch_src_ds_idx";--> statement-breakpoint
ALTER TABLE "integration_stitch" DROP COLUMN "src_data_source_id";