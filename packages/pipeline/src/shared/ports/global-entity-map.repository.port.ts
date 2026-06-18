export interface GemMappingParams {
  traceId: string;
  routeId: string;
  srcAppName: string;
  dataSourceId: string;
  srcOrganizationId: string;
  canonicalType: string;
  srcEntityId: string;
  targetAppName: string;
  targetConnectionId: string;
  targetOrganizationId: string;
  destEntityId: string;
}

export interface GlobalEntityMapRepositoryPort {
  /**
   * Retrieves the destination entity ID for a given mapping.
   */
  getDestinationEntityId(
    stitchId: string,
    sourceDataSourceId: string,
    sourceEntityId: string
  ): Promise<string | null>;

  /**
   * Writes a GEM linkage between source and destination entities.
   */
  writeGemMapping(
    tenantId: string,
    params: GemMappingParams
  ): Promise<void>;
}

export const GLOBAL_ENTITY_MAP_REPOSITORY_PORT = Symbol('GLOBAL_ENTITY_MAP_REPOSITORY_PORT');
