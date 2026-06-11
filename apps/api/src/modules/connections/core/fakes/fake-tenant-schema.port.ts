import type { TenantSchemaPort } from '../ports/outbound/tenant-schema.port.js';
import type { ProvisionInfo } from '../types/connection.types.js';

export class FakeTenantSchemaPort implements TenantSchemaPort {
  public provisionedNamespaces: Set<string> = new Set();
  public callCount = {
    provisionNamespace: 0,
    teardownNamespace: 0,
  };

  provisionNamespace(
    _tenantId: string,
    workspaceProvisionInfo: ProvisionInfo,
    _providerName: string,
    _metadata: Record<string, unknown>,
  ): Promise<void> {
    this.callCount.provisionNamespace++;
    if (workspaceProvisionInfo.schemaName) {
      this.provisionedNamespaces.add(workspaceProvisionInfo.schemaName);
    }
    return Promise.resolve();
  }

  teardownNamespace(_tenantId: string, _dataSourceId: string): Promise<void> {
    this.callCount.teardownNamespace++;
    // In fake logic, we can't easily map dataSourceId back to schemaName unless we pass it,
    // but this suffices for counting calls and basic verification.
    return Promise.resolve();
  }
}
