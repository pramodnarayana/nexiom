export interface ProvisionPlanParams {
  tenantId: string;
  schemaName: string;
  schemaPlan: string;
  appName: string;
  appProfile: string;
}

export interface DatabaseProvisionerPort {
  /**
   * Applies the schema plan (e.g., creating outbox tables lazily).
   */
  applyPlan(params: ProvisionPlanParams): Promise<void>;

  /**
   * Registers tables to the logical replication publication.
   */
  registerPublication(schemaName: string): Promise<void>;

  /**
   * Removes tables from the logical replication publication.
   */
  unregisterPublication(schemaName: string): Promise<void>;
}
