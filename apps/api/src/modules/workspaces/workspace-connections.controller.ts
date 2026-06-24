import {
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
  BadRequestException,
  Body,
} from '@nestjs/common';
import {
  AuthGuard,
  PermissionsGuard,
  RequirePermission,
  AuthContext,
  type RequestAuthContext,
} from '@soopa/auth';
import { ListWorkspaceConnectionsUseCase } from './core/use-cases/workspace.use-case.js';
import { GetConnectionForSyncUseCase } from './core/use-cases/workspace.use-case.js';
import { GetWorkspaceUseCase } from './core/use-cases/workspace.use-case.js';
import { SyncRunner } from '../scheduler/sync-runner.js';
import { requireOrgId } from './workspace.utils.js';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('workspaces/:workspaceId/connections')
export class WorkspaceConnectionsController {
  constructor(
    private readonly listWorkspaceConnectionsUseCase: ListWorkspaceConnectionsUseCase,
    private readonly getWorkspaceUseCase: GetWorkspaceUseCase,
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

    return this.listWorkspaceConnectionsUseCase.execute(orgId, workspaceId);
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

    return this.syncRunner.run(connection.id, objectType);
  }

  @Post(':dataSourceId/sync/:objectType/fetch')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('workspaces', 'manage')
  async fetchRecords(
    @AuthContext() auth: RequestAuthContext,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('dataSourceId', ParseUUIDPipe) dataSourceId: string,
    @Param('objectType') objectType: string,
    @Body('recordIds') recordIds: string[],
  ) {
    const orgId = requireOrgId(auth);

    const workspace = await this.ensureWorkspaceExists(orgId, workspaceId);

    if (!/^[\w.-]{1,200}$/.test(objectType)) {
      throw new BadRequestException(
        'Invalid objectType: must be alphanumeric with -/_ only, max 200 characters',
      );
    }

    if (!Array.isArray(recordIds) || recordIds.length === 0) {
      throw new BadRequestException('recordIds must be a non-empty array');
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

    return this.syncRunner.fetchRecords(connection.id, objectType, recordIds);
  }
}
