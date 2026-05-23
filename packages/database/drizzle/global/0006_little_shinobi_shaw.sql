DROP INDEX "cred_data_source_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "cred_data_source_idx" ON "credential" USING btree ("data_source_id");