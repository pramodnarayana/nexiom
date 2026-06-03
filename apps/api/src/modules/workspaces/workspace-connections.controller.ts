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
  Inject,
} from '@nestjs/common';
import {
  AuthGuard,
  PermissionsGuard,
  RequirePermission,
  AuthContext,
  type RequestAuthContext,
} from '@soopa/auth';
import { and, eq } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  uiWorkspaceDataSources,
  dataSources,
} from '@soopa/database';
import { WorkspacesService } from './workspaces.service.js';
import { SyncRunner } from '../scheduler/sync-runner.js';
import { requireOrgId } from './workspace.utils.js';
import { isUniqueViolation } from '../../shared/db.utils.js';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('workspaces/:workspaceId/connections')
export class WorkspaceConnectionsController {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly workspacesService: WorkspacesService,
    private readonly syncRunner: SyncRunner,
  ) {}

  @Get()
  @RequirePermission('workspaces', 'read')
  listConnections(
    @AuthContext() auth: RequestAuthContext,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workspacesService.listConnections(
      requireOrgId(auth),
      workspaceId,
    );
  }

  /** Active connections for this org that match the workspace env_type and are not yet assigned. */
  @Get('available')
  @RequirePermission('workspaces', 'read')
  listAvailable(
    @AuthContext() auth: RequestAuthContext,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workspacesService.listAvailableConnections(
      requireOrgId(auth),
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

    // Verify workspace belongs to this org
    const workspace = await this.workspacesService.findOne(orgId, workspaceId);

    // Verify connection belongs to this org — use explicit select to avoid leaking
    // the encrypted `value` blob.
    const [connection] = await this.db
      .select({
        id: dataSources.id,
        envType: dataSources.envType,
      })
      .from(dataSources)
      .where(
        and(eq(dataSources.id, dataSourceId), eq(dataSources.tenantId, orgId)),
      )
      .limit(1);
    if (!connection) {
      throw new NotFoundException(`Connection ${dataSourceId} not found.`);
    }

    // Enforce env-type parity — sandbox connections may not be assigned to production
    // workspaces and vice versa.
    if (connection.envType !== workspace.envType) {
      throw new ConflictException(
        `Cannot assign a ${connection.envType} connection to a ${workspace.envType} workspace.`,
      );
    }

    try {
      const [assignment] = await this.db
        .insert(uiWorkspaceDataSources)
        .values({ workspaceId, dataSourceId })
        .returning();
      return assignment;
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'Connection is already assigned to this workspace.',
        );
      }
      throw err;
    }
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

    // Verify workspace belongs to this org
    await this.workspacesService.findOne(orgId, workspaceId);

    await this.db
      .delete(uiWorkspaceDataSources)
      .where(
        and(
          eq(uiWorkspaceDataSources.workspaceId, workspaceId),
          eq(uiWorkspaceDataSources.dataSourceId, dataSourceId),
        ),
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
    const workspace = await this.workspacesService.findOne(orgId, workspaceId);

    // Validate objectType (alphanumeric + -/_ only, max 200 chars)
    if (!/^[\w.-]{1,200}$/.test(objectType)) {
      throw new BadRequestException(
        'Invalid objectType: must be alphanumeric with -/_ only, max 200 characters',
      );
    }

    // Verify the dataSourceId belongs to this org and implicitly matches workspace envType
    const [connection] = await this.db
      .select({
        id: dataSources.id,
      })
      .from(dataSources)
      .where(
        and(
          eq(dataSources.id, dataSourceId),
          eq(dataSources.tenantId, orgId),
          eq(dataSources.envType, workspace.envType),
        ),
      )
      .limit(1);
    if (!connection) {
      throw new NotFoundException(
        `Connection ${dataSourceId} not found or not accessible in this environment`,
      );
    }

    // Initial Manual Sync
    const result = await this.syncRunner.run(dataSourceId, objectType);
    return result;
  }
}
