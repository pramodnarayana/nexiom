import type {
  WorkspaceRepositoryPort,
  CreateWorkspaceParams,
  UpdateWorkspaceParams,
  WorkspaceRecord,
  ConnectionRecord,
} from '../ports/outbound/workspace-repository.port.js';

export class CreateWorkspaceUseCase {
  constructor(private readonly repository: WorkspaceRepositoryPort) {}
  async execute(params: CreateWorkspaceParams): Promise<WorkspaceRecord> {
    return this.repository.create(params);
  }
}

export class UpdateWorkspaceUseCase {
  constructor(private readonly repository: WorkspaceRepositoryPort) {}
  async execute(
    orgId: string,
    id: string,
    params: UpdateWorkspaceParams,
  ): Promise<WorkspaceRecord | null> {
    return this.repository.update(orgId, id, params);
  }
}

export class DeleteWorkspaceUseCase {
  constructor(private readonly repository: WorkspaceRepositoryPort) {}
  async execute(orgId: string, id: string): Promise<WorkspaceRecord | null> {
    return this.repository.remove(orgId, id);
  }
}

export class GetWorkspaceUseCase {
  constructor(private readonly repository: WorkspaceRepositoryPort) {}
  async execute(orgId: string, id: string): Promise<WorkspaceRecord | null> {
    return this.repository.findOne(orgId, id);
  }
}

export class ListWorkspacesUseCase {
  constructor(private readonly repository: WorkspaceRepositoryPort) {}
  async execute(orgId: string): Promise<WorkspaceRecord[]> {
    return this.repository.list(orgId);
  }
}

export class ListWorkspaceConnectionsUseCase {
  constructor(private readonly repository: WorkspaceRepositoryPort) {}
  async execute(
    orgId: string,
    workspaceId: string,
    availableOnly: boolean = false,
  ): Promise<ConnectionRecord[]> {
    if (availableOnly) {
      return this.repository.listAvailableConnections(orgId, workspaceId);
    }
    return this.repository.listConnections(orgId, workspaceId);
  }
}
