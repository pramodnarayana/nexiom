import type { ProvisionInfo } from '../../types/connection.types.js';

export interface ConnectionLifecyclePort {
  /**
   * Activates the connection credentials and emits async outbox provisioning events.
   */
  activateAndProvision(
    tenantId: string,
    workspaceProvisionInfo: ProvisionInfo,
    providerName: string,
    metadata: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Safely verifies the connection is not in use and tears it down, emitting deletion events.
   */
  safeTeardown(tenantId: string, dataSourceId: string): Promise<void>;
}
