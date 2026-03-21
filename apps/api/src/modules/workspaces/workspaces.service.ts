import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq, and, asc, notInArray } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  uiWorkspaces,
  uiWorkspaceConnections,
  appConnections,
  AppConnectionStatus,
} from '@nexiom/database';
import type {
  CreateWorkspace,
  UpdateWorkspace,
} from './workspaces.validation.js';

/** Postgres unique-constraint violation error code. */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === PG_UNIQUE_VIOLATION
  );
}

@Injectable()
export class WorkspacesService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async create(orgId: string, body: CreateWorkspace) {
    try {
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
      .select({ connectionId: uiWorkspaceConnections.connectionId })
      .from(uiWorkspaceConnections)
      .where(eq(uiWorkspaceConnections.workspaceId, workspaceId));

    const assignedIds = assigned.map((r) => r.connectionId);

    const conditions = [
      eq(appConnections.tenantId, orgId),
      eq(appConnections.status, AppConnectionStatus.ACTIVE),
      eq(appConnections.envType, workspace.envType),
    ];

    if (assignedIds.length > 0) {
      conditions.push(notInArray(appConnections.id, assignedIds));
    }

    // Explicit select — never expose the encrypted `value` blob or other sensitive columns.
    return this.db
      .select({
        id: appConnections.id,
        appName: appConnections.appName,
        externalId: appConnections.externalId,
        displayName: appConnections.displayName,
        authType: appConnections.authType,
        status: appConnections.status,
        envType: appConnections.envType,
      })
      .from(appConnections)
      .where(and(...conditions))
      .orderBy(asc(appConnections.displayName));
  }

  /** Returns active connections assigned to the workspace, scoped to the org. */
  async listConnections(orgId: string, workspaceId: string) {
    const rows = await this.db
      .select({
        workspaceId: uiWorkspaces.id,
        id: appConnections.id,
        appName: appConnections.appName,
        externalId: appConnections.externalId,
        displayName: appConnections.displayName,
        authType: appConnections.authType,
        status: appConnections.status,
        assignedAt: uiWorkspaceConnections.assignedAt,
      })
      .from(uiWorkspaces)
      .leftJoin(
        uiWorkspaceConnections,
        eq(uiWorkspaces.id, uiWorkspaceConnections.workspaceId),
      )
      .leftJoin(
        appConnections,
        and(
          eq(uiWorkspaceConnections.connectionId, appConnections.id),
          eq(appConnections.tenantId, orgId),
          eq(appConnections.status, AppConnectionStatus.ACTIVE),
        ),
      )
      .where(
        and(eq(uiWorkspaces.id, workspaceId), eq(uiWorkspaces.orgId, orgId)),
      )
      .orderBy(asc(uiWorkspaceConnections.assignedAt));

    if (rows.length === 0) {
      throw new NotFoundException(`Workspace ${workspaceId} not found.`);
    }

    // Filter out the sentinel row produced when no connections are assigned
    return rows
      .filter((r) => r.id !== null)
      .map(({ workspaceId: _ws, ...rest }) => rest);
  }
}
