export const FIELD_MAPPING_REPOSITORY_PORT = 'FIELD_MAPPING_REPOSITORY_PORT';

export interface FieldMappingRepositoryPort {
  /**
   * Atomically deletes and upserts mappings in a single transaction.
   * Throws NotFoundException if stitch does not belong to org.
   */
  bulkUpsertAndDelete(
    orgId: string,
    stitchId: string,
    params: {
      toDelete: string[];
      toUpsert: {
        sourceCanonical: string;
        mappingRules: any[];
      }[];
    },
  ): Promise<unknown[]>;

  /**
   * Upsert a single field mapping.
   * Throws NotFoundException if stitch does not belong to org.
   */
  upsertMapping(
    orgId: string,
    stitchId: string,
    params: {
      sourceCanonical: string;
      mappingRules: any[];
    },
  ): Promise<unknown>;

  /**
   * Delete field mappings for a sourceCanonical.
   * Idempotent — no error if absent.
   */
  deleteMapping(
    orgId: string,
    stitchId: string,
    sourceCanonical: string,
  ): Promise<void>;
}
