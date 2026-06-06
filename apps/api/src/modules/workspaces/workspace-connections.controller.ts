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
import { WorkspaceRepository } from './repositories/workspace.repository.js';
import { SyncRunner } from '../scheduler/sync-runner.js';
import { requireOrgId } from './workspace.utils.js';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('workspaces/:workspaceId/connections')
export class WorkspaceConnectionsController {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly syncRunner: SyncRunner,
  ) {}

  @Get()
  @RequirePermission('workspaces', 'read')
  async listConnections(
    @AuthContext() auth: RequestAuthContext,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    const orgId = requireOrgId(auth);
    const workspace = await this.workspaceRepository.findByIdAndOrg(
      workspaceId,
      orgId,
    );
    if (!workspace) throw new NotFoundException('Workspace not found');

    return this.workspaceRepository.listConnections(orgId, workspace.envType);
  }

  /** Active connections for this org that match the workspace env_type and are not yet assigned. */
  @Get('available')
  @RequirePermission('workspaces', 'read')
  async listAvailable(
    @AuthContext() auth: RequestAuthContext,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    const orgId = requireOrgId(auth);
    const workspace = await this.workspaceRepository.findByIdAndOrg(
      workspaceId,
      orgId,
    );
    if (!workspace) throw new NotFoundException('Workspace not found');

    return this.workspaceRepository.listAvailableConnections(
      orgId,
      workspace.envType,
      workspaceId,
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

    const workspace = await this.workspaceRepository.findByIdAndOrg(
      workspaceId,
      orgId,
    );
    if (!workspace) throw new NotFoundException('Workspace not found');

    const connection =
      await this.workspaceRepository.findConnectionForAssignment(
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

    const assignment = await this.workspaceRepository.assignConnection(
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

    const workspace = await this.workspaceRepository.findByIdAndOrg(
      workspaceId,
      orgId,
    );
    if (!workspace) throw new NotFoundException('Workspace not found');

    await this.workspaceRepository.unassignConnection(
      workspaceId,
      dataSourceId,
    );
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

    const workspace = await this.workspaceRepository.findByIdAndOrg(
      workspaceId,
      orgId,
    );
    if (!workspace) throw new NotFoundException('Workspace not found');

    if (!/^[\w.-]{1,200}$/.test(objectType)) {
      throw new BadRequestException(
        'Invalid objectType: must be alphanumeric with -/_ only, max 200 characters',
      );
    }

    const connection = await this.workspaceRepository.findConnectionForSync(
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
