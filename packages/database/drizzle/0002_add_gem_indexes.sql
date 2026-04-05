CREATE INDEX IF NOT EXISTS "gem_source_app_idx" ON "global_entity_map" USING btree ("source_app_id");
CREATE INDEX IF NOT EXISTS "gem_dest_app_idx" ON "global_entity_map" USING btree ("dest_app_id");