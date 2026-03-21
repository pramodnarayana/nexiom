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
  ConflictException,
  Inject,
} from '@nestjs/common';
import {
  AuthGuard,
  PermissionsGuard,
  RequirePermission,
  AuthContext,
  type RequestAuthContext,
} from '@nexiom/auth';
import { and, eq } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  uiWorkspaceConnections,
  appConnections,
  safeAppConnectionColumns,
  AppConnectionStatus,
} from '@nexiom/database';
import { WorkspacesService } from './workspaces.service.js';
import { requireOrgId } from './workspace.utils.js';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('workspaces/:workspaceId/connections')
export class WorkspaceConnectionsController {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly workspacesService: WorkspacesService,
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

  @Post(':connectionId')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('workspaces', 'manage')
  async assign(
    @AuthContext() auth: RequestAuthContext,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    const orgId = requireOrgId(auth);

    // Verify workspace belongs to this org
    const workspace = await this.workspacesService.findOne(orgId, workspaceId);

    // Verify connection belongs to this org — use explicit select to avoid leaking
    // the encrypted `value` blob.
    const [connection] = await this.db
      .select({
        id: safeAppConnectionColumns.id,
        envType: safeAppConnectionColumns.envType,
      })
      .from(appConnections)
      .where(
        and(
          eq(appConnections.id, connectionId),
          eq(appConnections.tenantId, orgId),
          eq(appConnections.status, AppConnectionStatus.ACTIVE),
        ),
      )
      .limit(1);
    if (!connection) {
      throw new NotFoundException(`Connection ${connectionId} not found.`);
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
        .insert(uiWorkspaceConnections)
        .values({ workspaceId, connectionId })
        .returning();
      return assignment;
    } catch (err: unknown) {
      // PG unique-violation → already assigned
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new ConflictException(
          'Connection is already assigned to this workspace.',
        );
      }
      throw err;
    }
  }

  @Delete(':connectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('workspaces', 'manage')
  async unassign(
    @AuthContext() auth: RequestAuthContext,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    const orgId = requireOrgId(auth);

    // Verify workspace belongs to this org
    await this.workspacesService.findOne(orgId, workspaceId);

    await this.db
      .delete(uiWorkspaceConnections)
      .where(
        and(
          eq(uiWorkspaceConnections.workspaceId, workspaceId),
          eq(uiWorkspaceConnections.connectionId, connectionId),
        ),
      );
  }
}
