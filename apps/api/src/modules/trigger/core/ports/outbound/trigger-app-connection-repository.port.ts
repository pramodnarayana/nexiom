export interface TriggerConnectionRecord {
  workspaceId: string;
  tenantId: string;
  appName: string;
  triggerName: string;
  objectType: string | undefined;
  auth: unknown;
  propsValue: Record<string, unknown>;
  webhookSecret: string | undefined;
  appProfile: string;
}

export interface TriggerAppConnectionRepositoryPort {
  /**
   * Retrieves an active webhook connection by data source ID.
   */
  findActiveConnection(
    dataSourceId: string,
  ): Promise<TriggerConnectionRecord | null>;
}
