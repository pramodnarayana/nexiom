export const STITCH_REPOSITORY_PORT = 'STITCH_REPOSITORY_PORT';

export interface StitchRepositoryPort {
  /**
   * Creates a stitch and any associated field mappings in a single transaction,
   * then emits the appropriate outbox events.
   * Throws ConflictException if a unique violation occurs.
   */
  createStitch(
    orgId: string,
    params: {
      name: string;
      workspaceId: string;
      sourceDataSourceId: string;
      destDataSourceId: string;
      canonicalObject?: string;
      targetObject?: string;
      syncCondition?: unknown[];
      status?: 'ACTIVE' | 'PAUSED';
      fieldMappings?: {
        sourceCanonical: string;
        mappingRules: unknown[];
      }[];
    },
  ): Promise<{
    stitch: unknown;
    destConnAppName: string;
    destEntityanizationId: string | null;
    destAppProfile?: string;
  }>;

  /**
   * Lists stitches for an organization (and optionally workspace).
   */
  listStitches(
    orgId: string,
    workspaceId?: string,
    includeArchived?: boolean,
  ): Promise<unknown[]>;

  /**
   * Retrieves a stitch and its associated field mappings.
   * Throws NotFoundException if not found.
   */
  getStitch(orgId: string, id: string): Promise<unknown>;

  /**
   * Updates a stitch's properties and queues an outbox event.
   * Throws NotFoundException if not found, ConflictException if duplicate name.
   */
  updateStitch(
    orgId: string,
    id: string,
    params: {
      name?: string;
      status?: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
      syncCondition?: unknown[];
    },
  ): Promise<unknown>;

  /**
   * Soft-deletes a stitch (status='ARCHIVED') and queues an outbox event.
   * Throws NotFoundException if not found.
   */
  archiveStitch(orgId: string, id: string): Promise<void>;
}
