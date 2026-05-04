import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq, and, asc, notInArray, sql } from 'drizzle-orm';
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
import { isUniqueViolation } from '../../shared/db.utils.js';

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async create(orgId: string, body: CreateWorkspace) {
    try {
      // ── Deferred Provisioning: Claim a WARM database slot ──────────────
      // Only claim a new database if this org does not already have one.
      // FOR UPDATE SKIP LOCKED ensures concurrent workspace creations do not
      // race to claim the same slot.
      const hasDb = await this.db.execute<{ tenant_id: string }>(
        sql`SELECT tenant_id
            FROM tenant_storage_registry
            WHERE tenant_id = ${orgId}
              AND status = 'ACTIVE'
            LIMIT 1`,
      );

      if ((hasDb.rowCount ?? 0) === 0) {
        const claimed = await this.db.execute<{ tenant_id: string }>(
          sql`UPDATE tenant_storage_registry
              SET tenant_id = ${orgId}, status = 'ACTIVE', updated_at = NOW()
              WHERE tenant_id = (
                SELECT tenant_id FROM tenant_storage_registry
                WHERE status = 'WARM'
                LIMIT 1
                FOR UPDATE SKIP LOCKED
              )
              RETURNING tenant_id`,
        );

        if ((claimed.rowCount ?? 0) === 0) {
          // Pool is empty — the CapacityManager will replenish it shortly.
          // Return 503 so the client can retry after the pool is filled.
          throw new ServiceUnavailableException(
            'Workspace infrastructure is being provisioned. Please try again in a few seconds.',
          );
        }

        this.logger.log(`Claimed WARM database slot for orgId=${orgId}`);
      }

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
