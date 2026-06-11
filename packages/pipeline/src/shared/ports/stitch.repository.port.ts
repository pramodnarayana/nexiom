import { Condition } from "../../index.js";

export interface ActiveStitch {
  id: string;
  name: string;
  orgId: string;
  workspaceId: string;
  destDataSourceId: string;
  canonicalObject: string;
  targetObject: string;
  syncCondition: Condition[] | unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  sourceDataSourceId: string;
}

export interface StitchRepositoryPort {
  /**
   * Finds all active stitches for a given source connection and canonical type.
   */
  findActiveStitches(
    tenantId: string,
    dataSourceId: string,
    canonicalType: string
  ): Promise<ActiveStitch[]>;

  /**
   * Finds a specific active stitch by ID.
   */
  findById(
    tenantId: string,
    stitchId: string
  ): Promise<ActiveStitch | null>;
}

export const STITCH_REPOSITORY_PORT = Symbol('STITCH_REPOSITORY_PORT');
