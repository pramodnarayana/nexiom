import type { ConnectionLifecyclePort } from '../ports/outbound/connection-lifecycle.port.js';

export class DeleteConnectionUseCase {
  constructor(
    private readonly connectionLifecyclePort: ConnectionLifecyclePort,
  ) {}

  async execute(tenantId: string, dataSourceId: string): Promise<void> {
    // The teardown namespace handles the strict checks against GlobalEntityMap
    // and deletes the connection from the global DB inside an advisory lock.
    await this.connectionLifecyclePort.safeTeardown(tenantId, dataSourceId);
  }
}
