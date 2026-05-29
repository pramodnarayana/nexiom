import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq, and, asc, notInArray, inArray } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  uiWorkspaces,
  uiWorkspaceDataSources,
  dataSources,
  credentials,
  AppConnectionStatus,
} from '@nexiom/database';
import type {
  CreateWorkspace,
  UpdateWorkspace,
} from './workspaces.validation.js';
import { isUniqueViolation } from '../../shared/db.utils.js';

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async create(orgId: string, body: CreateWorkspace) {
    try {
      // ── Create the logical Workspace record ───────────────────────────
      const [workspace] = await this.db
        .insert(uiWorkspaces)
        .values({
          orgId,
          name: body.name,
          envType: body.envType ?? 'PRODUCTION',
        })
        .returning();

      if (!workspace) {
        throw new InternalServerErrorException('Insert did not return a row.');
      }
      return workspace;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A ${body.envType ?? 'PRODUCTION'} workspace named "${body.name}" already exists in this organisation.`,
        );
      }
      throw err;
    }
  }

  async list(orgId: string) {
    return this.db.query.uiWorkspaces.findMany({
      where: eq(uiWorkspaces.orgId, orgId),
      orderBy: [asc(uiWorkspaces.createdAt)],
    });
  }

  async findOne(orgId: string, id: string) {
    const workspace = await this.db.query.uiWorkspaces.findFirst({
      where: and(eq(uiWorkspaces.id, id), eq(uiWorkspaces.orgId, orgId)),
    });
    if (!workspace) {
      throw new NotFoundException(`Workspace ${id} not found.`);
    }
    return workspace;
  }

  async update(orgId: string, id: string, body: UpdateWorkspace) {
    const hasChanges = body.name !== undefined || body.envType !== undefined;
    if (!hasChanges) {
      throw new BadRequestException('No updatable fields provided.');
    }

    try {
      const [updated] = await this.db
        .update(uiWorkspaces)
        .set({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.envType !== undefined && { envType: body.envType }),
          updatedAt: new Date(),
        })
        .where(and(eq(uiWorkspaces.id, id), eq(uiWorkspaces.orgId, orgId)))
        .returning();

      if (!updated) {
        throw new NotFoundException(`Workspace ${id} not found.`);
      }
      return updated;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'Workspace with the provided identifier already exists.',
        );
      }
      throw err;
    }
  }

  async remove(orgId: string, id: string) {
    const [deleted] = await this.db
      .delete(uiWorkspaces)
      .where(and(eq(uiWorkspaces.id, id), eq(uiWorkspaces.orgId, orgId)))
      .returning();

    if (!deleted) {
      throw new NotFoundException(`Workspace ${id} not found.`);
    }
  }

  /**
   * Returns active connections for the org that match the workspace's env_type
   * and have not yet been assigned to this workspace.
   * Used to populate the "Assign Connection" picker in the UI.
   */
  async listAvailableConnections(orgId: string, workspaceId: string) {
    const workspace = await this.findOne(orgId, workspaceId);

    const assigned = await this.db
      .select({ dataSourceId: uiWorkspaceDataSources.dataSourceId })
      .from(uiWorkspaceDataSources)
      .where(eq(uiWorkspaceDataSources.workspaceId, workspaceId));

    const assignedIds = assigned.map((r) => r.dataSourceId);

    const conditions = [
      eq(dataSources.tenantId, orgId),
      // Do not filter strictly by ACTIVE, otherwise REVOKED connections become invisible orphans
      // that users cannot delete or re-authenticate.
      inArray(credentials.status, [
        AppConnectionStatus.ACTIVE,
        AppConnectionStatus.REVOKED,
        AppConnectionStatus.EXPIRED,
        AppConnectionStatus.FAILED,
      ]),
      eq(dataSources.envType, workspace.envType),
    ];

    if (assignedIds.length > 0) {
      conditions.push(notInArray(dataSources.id, assignedIds));
    }

    return this.db
      .select({
        id: dataSources.id,
        appName: dataSources.appName,
        externalId: dataSources.externalId,
        displayName: dataSources.displayName,
        authType: credentials.authType,
        status: credentials.status,
        envType: dataSources.envType,
      })
      .from(dataSources)
      .innerJoin(credentials, eq(credentials.dataSourceId, dataSources.id))
      .where(and(...conditions))
      .orderBy(asc(dataSources.displayName));
  }

  /** Returns active connections assigned to the workspace, scoped to the org. */
  async listConnections(orgId: string, workspaceId: string) {
    const rows = await this.db
      .select({
        workspaceId: uiWorkspaces.id,
        id: dataSources.id,
        appName: dataSources.appName,
        externalId: dataSources.externalId,
        displayName: dataSources.displayName,
        authType: credentials.authType,
        status: credentials.status,
        assignedAt: uiWorkspaceDataSources.assignedAt,
      })
      .from(uiWorkspaces)
      .leftJoin(
        uiWorkspaceDataSources,
        eq(uiWorkspaces.id, uiWorkspaceDataSources.workspaceId),
      )
      .leftJoin(
        dataSources,
        and(
          eq(uiWorkspaceDataSources.dataSourceId, dataSources.id),
          eq(dataSources.tenantId, orgId),
        ),
      )
      .leftJoin(
        credentials,
        and(
          eq(credentials.dataSourceId, dataSources.id),
          inArray(credentials.status, [
            AppConnectionStatus.ACTIVE,
            AppConnectionStatus.REVOKED,
            AppConnectionStatus.EXPIRED,
            AppConnectionStatus.FAILED,
          ]),
        ),
      )
      .where(
        and(eq(uiWorkspaces.id, workspaceId), eq(uiWorkspaces.orgId, orgId)),
      )
      .orderBy(asc(uiWorkspaceDataSources.assignedAt));

    if (rows.length === 0) {
      throw new NotFoundException(`Workspace ${workspaceId} not found.`);
    }

    // Filter out the sentinel row produced when no connections are assigned
    return rows
      .filter((r) => r.id !== null)
      .map(({ workspaceId: _ws, ...rest }) => rest);
  }
}
