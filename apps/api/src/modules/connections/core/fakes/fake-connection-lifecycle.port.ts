import type { ConnectionLifecyclePort } from '../ports/outbound/connection-lifecycle.port.js';
import type { ProvisionInfo } from '../types/connection.types.js';

export class FakeConnectionLifecyclePort implements ConnectionLifecyclePort {
  public provisionedNamespaces: Set<string> = new Set();
  public callCount = {
    activateAndProvision: 0,
    safeTeardown: 0,
  };

  async activateAndProvision(
    _tenantId: string,
    workspaceProvisionInfo: ProvisionInfo,
    _providerName: string,
    _metadata: Record<string, unknown>,
  ): Promise<void> {
    this.callCount.activateAndProvision++;
    if (workspaceProvisionInfo.schemaName) {
      this.provisionedNamespaces.add(workspaceProvisionInfo.schemaName);
    }
    return Promise.resolve();
  }

  async safeTeardown(_tenantId: string, _dataSourceId: string): Promise<void> {
    this.callCount.safeTeardown++;
    return Promise.resolve();
  }
}
