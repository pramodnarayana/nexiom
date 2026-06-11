import { Rule } from "../../index.js";

export interface FieldMappingRepositoryPort {
  /**
   * Retrieves the field mapping rules for a given stitch and canonical type.
   */
  getMappingRules(
    tenantId: string,
    stitchId: string,
    canonicalType: string
  ): Promise<Rule[] | null>;
}

export const FIELD_MAPPING_REPOSITORY_PORT = Symbol('FIELD_MAPPING_REPOSITORY_PORT');
