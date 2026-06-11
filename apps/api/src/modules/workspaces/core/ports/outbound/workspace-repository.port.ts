export interface CreateWorkspaceParams {
  orgId: string;
  name: string;
  envType: 'PRODUCTION' | 'SANDBOX';
}

export interface UpdateWorkspaceParams {
  name?: string;
  envType?: 'PRODUCTION' | 'SANDBOX';
}

export interface WorkspaceRecord {
  id: string;
  orgId: string;
  name: string;
  envType: 'PRODUCTION' | 'SANDBOX';
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectionRecord {
  id: string;
  appName: string;
  externalId: string;
  displayName: string;
  authType: string | null;
  status: string | null;
  envType: 'PRODUCTION' | 'SANDBOX';
  metadata?: Record<string, unknown> | null;
  assignedAt?: Date | null;
}

export interface WorkspaceRepositoryPort {
  create(params: CreateWorkspaceParams): Promise<WorkspaceRecord>;
  list(orgId: string): Promise<WorkspaceRecord[]>;
  findOne(orgId: string, id: string): Promise<WorkspaceRecord | null>;
  update(
    orgId: string,
    id: string,
    params: UpdateWorkspaceParams,
  ): Promise<WorkspaceRecord | null>;
  remove(orgId: string, id: string): Promise<WorkspaceRecord | null>;
  listAvailableConnections(
    orgId: string,
    workspaceId: string,
  ): Promise<ConnectionRecord[]>;
  listConnections(
    orgId: string,
    workspaceId: string,
  ): Promise<ConnectionRecord[]>;
  findConnectionForAssignment(
    dataSourceId: string,
    orgId: string,
  ): Promise<{ id: string; envType: 'PRODUCTION' | 'SANDBOX' } | null>;
  findConnectionForSync(
    dataSourceId: string,
    orgId: string,
    envType: 'PRODUCTION' | 'SANDBOX',
  ): Promise<{ id: string } | null>;
  assignConnection(
    workspaceId: string,
    dataSourceId: string,
  ): Promise<{ workspaceId: string; dataSourceId: string } | null>;
  unassignConnection(workspaceId: string, dataSourceId: string): Promise<void>;
}
