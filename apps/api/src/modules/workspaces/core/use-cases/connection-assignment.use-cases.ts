import type { WorkspaceRepositoryPort } from '../ports/outbound/workspace-repository.port.js';

export class AssignConnectionUseCase {
  constructor(private readonly repository: WorkspaceRepositoryPort) {}
  async execute(
    workspaceId: string,
    dataSourceId: string,
  ): Promise<{ workspaceId: string; dataSourceId: string } | null> {
    return this.repository.assignConnection(workspaceId, dataSourceId);
  }
}

export class UnassignConnectionUseCase {
  constructor(private readonly repository: WorkspaceRepositoryPort) {}
  async execute(workspaceId: string, dataSourceId: string): Promise<void> {
    return this.repository.unassignConnection(workspaceId, dataSourceId);
  }
}

export class GetConnectionForAssignmentUseCase {
  constructor(private readonly repository: WorkspaceRepositoryPort) {}
  async execute(
    dataSourceId: string,
    orgId: string,
  ): Promise<{ id: string; envType: 'PRODUCTION' | 'SANDBOX' } | null> {
    return this.repository.findConnectionForAssignment(dataSourceId, orgId);
  }
}

export class GetConnectionForSyncUseCase {
  constructor(private readonly repository: WorkspaceRepositoryPort) {}
  async execute(
    dataSourceId: string,
    orgId: string,
    envType: 'PRODUCTION' | 'SANDBOX',
  ): Promise<{ id: string } | null> {
    return this.repository.findConnectionForSync(dataSourceId, orgId, envType);
  }
}
