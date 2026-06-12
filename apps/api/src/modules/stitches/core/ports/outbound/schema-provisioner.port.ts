export const SCHEMA_PROVISIONER_PORT = 'SCHEMA_PROVISIONER_PORT';

export interface SchemaProvisionerPort {
  /**
   * Idempotently provisions connection schemas to a specified plan (e.g. OUTBOUND_ACTIVE)
   * so the full pipeline table stack is ready.
   */
  provisionStitchSchemas(
    orgId: string,
    destDataSourceId: string,
    destAppName: string,
    destAppProfile?: string,
  ): Promise<void>;
}
