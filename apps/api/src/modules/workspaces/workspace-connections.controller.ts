import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  AuthGuard,
  PermissionsGuard,
  RequirePermission,
  AuthContext,
  type RequestAuthContext,
} from '@soopa/auth';
import { ListWorkspaceConnectionsUseCase } from './core/use-cases/workspace.use-cases.js';
import {
  AssignConnectionUseCase,
  UnassignConnectionUseCase,
  GetConnectionForAssignmentUseCase,
  GetConnectionForSyncUseCase,
} from './core/use-cases/connection-assignment.use-cases.js';
import { GetWorkspaceUseCase } from './core/use-cases/workspace.use-cases.js';
import { SyncRunner } from '../scheduler/sync-runner.js';
import { requireOrgId } from './workspace.utils.js';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('workspaces/:workspaceId/connections')
export class WorkspaceConnectionsController {
  constructor(
    private readonly listWorkspaceConnectionsUseCase: ListWorkspaceConnectionsUseCase,
    private readonly getWorkspaceUseCase: GetWorkspaceUseCase,
    private readonly assignConnectionUseCase: AssignConnectionUseCase,
    private readonly unassignConnectionUseCase: UnassignConnectionUseCase,
    private readonly getConnectionForAssignmentUseCase: GetConnectionForAssignmentUseCase,
    private readonly getConnectionForSyncUseCase: GetConnectionForSyncUseCase,
    private readonly syncRunner: SyncRunner,
  ) {}

  private async ensureWorkspaceExists(orgId: string, workspaceId: string) {
    const workspace = await this.getWorkspaceUseCase.execute(
      orgId,
      workspaceId,
    );
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  @Get()
  @RequirePermission('workspaces', 'read')
  async listConnections(
    @AuthContext() auth: RequestAuthContext,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    const orgId = requireOrgId(auth);
    await this.ensureWorkspaceExists(orgId, workspaceId);

    return this.listWorkspaceConnectionsUseCase.execute(
      orgId,
      workspaceId,
      false, // availableOnly = false
    );
  }

  /** Active connections for this org that match the workspace env_type and are not yet assigned. */
  @Get('available')
  @RequirePermission('workspaces', 'read')
  async listAvailable(
    @AuthContext() auth: RequestAuthContext,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    const orgId = requireOrgId(auth);
    await this.ensureWorkspaceExists(orgId, workspaceId);

    return this.listWorkspaceConnectionsUseCase.execute(
      orgId,
      workspaceId,
      true, // availableOnly = true
    );
  }

  @Post(':dataSourceId')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('workspaces', 'manage')
  async assign(
    @AuthContext() auth: RequestAuthContext,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('dataSourceId', ParseUUIDPipe) dataSourceId: string,
  ) {
    const orgId = requireOrgId(auth);

    const workspace = await this.ensureWorkspaceExists(orgId, workspaceId);

    const connection = await this.getConnectionForAssignmentUseCase.execute(
      dataSourceId,
      orgId,
    );
    if (!connection)
      throw new NotFoundException(`Connection ${dataSourceId} not found.`);

    if (connection.envType !== workspace.envType) {
      throw new ConflictException(
        `Cannot assign a ${connection.envType} connection to a ${workspace.envType} workspace.`,
      );
    }

    const assignment = await this.assignConnectionUseCase.execute(
      workspaceId,
      dataSourceId,
    );
    if (!assignment) {
      throw new ConflictException(
        'Connection is already assigned to this workspace.',
      );
    }
    return assignment;
  }

  @Delete(':dataSourceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('workspaces', 'manage')
  async unassign(
    @AuthContext() auth: RequestAuthContext,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('dataSourceId', ParseUUIDPipe) dataSourceId: string,
  ) {
    const orgId = requireOrgId(auth);

    await this.ensureWorkspaceExists(orgId, workspaceId);

    await this.unassignConnectionUseCase.execute(workspaceId, dataSourceId);
  }

  @Post(':dataSourceId/sync/:objectType')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('workspaces', 'manage')
  async sync(
    @AuthContext() auth: RequestAuthContext,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('dataSourceId', ParseUUIDPipe) dataSourceId: string,
    @Param('objectType') objectType: string,
  ) {
    const orgId = requireOrgId(auth);

    const workspace = await this.ensureWorkspaceExists(orgId, workspaceId);

    if (!/^[\w.-]{1,200}$/.test(objectType)) {
      throw new BadRequestException(
        'Invalid objectType: must be alphanumeric with -/_ only, max 200 characters',
      );
    }

    const connection = await this.getConnectionForSyncUseCase.execute(
      dataSourceId,
      orgId,
      workspace.envType,
    );
    if (!connection) {
      throw new NotFoundException(
        `Connection ${dataSourceId} not found or not accessible in this environment`,
      );
    }

    return this.syncRunner.run(dataSourceId, objectType);
  }
}
