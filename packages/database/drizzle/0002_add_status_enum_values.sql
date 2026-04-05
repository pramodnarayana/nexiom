ALTER TYPE "public"."connection_status_enum" ADD VALUE 'PROVISIONING';
ALTER TYPE "public"."connection_status_enum" ADD VALUE 'FAILED';

ALTER TABLE "global_entity_map" DROP CONSTRAINT "global_entity_map_source_app_id_app_connection_id_fk";
ALTER TABLE "global_entity_map" ADD CONSTRAINT "global_entity_map_source_app_id_app_connection_id_fk" FOREIGN KEY ("source_app_id") REFERENCES "public"."app_connection"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "global_entity_map" DROP CONSTRAINT "global_entity_map_dest_app_id_app_connection_id_fk";
ALTER TABLE "global_entity_map" ADD CONSTRAINT "global_entity_map_dest_app_id_app_connection_id_fk" FOREIGN KEY ("dest_app_id") REFERENCES "public"."app_connection"("id") ON DELETE restrict ON UPDATE no action;