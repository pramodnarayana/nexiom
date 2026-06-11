import type { TenantSchemaPort } from '../ports/outbound/tenant-schema.port.js';

export class DeleteConnectionUseCase {
  constructor(private readonly tenantSchemaPort: TenantSchemaPort) {}

  async execute(tenantId: string, dataSourceId: string): Promise<void> {
    // The teardown namespace handles the strict checks against GlobalEntityMap
    // and deletes the connection from the global DB inside an advisory lock.
    await this.tenantSchemaPort.teardownNamespace(tenantId, dataSourceId);
  }
}
