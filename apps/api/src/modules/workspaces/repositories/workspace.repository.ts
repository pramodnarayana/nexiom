import { Injectable, Inject } from '@nestjs/common';
import {
  BaseRepository,
  RepositoryContext,
  uiWorkspaces,
  uiWorkspaceDataSources,
  dataSources,
  credentials,
  AppConnectionStatus,
  DATABASE_CONNECTION,
  SAVEPOINT_MANAGER,
} from '@soopa/database';
import type { DrizzleDb, ISavePointManager } from '@soopa/database';
import { eq, and, asc, notInArray, inArray } from 'drizzle-orm';
import { isUniqueViolation } from '../../../shared/db.utils.js';

@Injectable()
export class WorkspaceRepository extends BaseRepository<typeof uiWorkspaces> {
  constructor(
    @Inject(DATABASE_CONNECTION) db: DrizzleDb,
    @Inject(SAVEPOINT_MANAGER) savepointManager: ISavePointManager,
  ) {
    super(db, savepointManager, uiWorkspaces);
  }

  async findByOrg(orgId: string, ctx?: RepositoryContext) {
    const exec = this.getExecutor(ctx);
    return exec
      .select()
      .from(uiWorkspaces)
      .where(eq(uiWorkspaces.orgId, orgId))
      .orderBy(asc(uiWorkspaces.createdAt));
  }

  async findByIdAndOrg(id: string, orgId: string, ctx?: RepositoryContext) {
    const exec = this.getExecutor(ctx);
    const result = await exec
      .select()
      .from(uiWorkspaces)
      .where(and(eq(uiWorkspaces.id, id), eq(uiWorkspaces.orgId, orgId)))
      .limit(1);
    return result[0] || null;
  }

  async createWorkspace(
    orgId: string,
    data: { name: string; envType?: 'PRODUCTION' | 'SANDBOX' },
    ctx?: RepositoryContext,
  ) {
    const exec = this.getExecutor(ctx);
    const [workspace] = await exec
      .insert(uiWorkspaces)
      .values({ orgId, name: data.name, envType: data.envType ?? 'PRODUCTION' })
      .returning();
    return workspace ?? null;
  }

  async updateWorkspace(
    id: string,
    orgId: string,
    data: Partial<{ name: string; envType: 'PRODUCTION' | 'SANDBOX' }>,
    ctx?: RepositoryContext,
  ) {
    const exec = this.getExecutor(ctx);
    const result = await exec
      .update(uiWorkspaces)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(uiWorkspaces.id, id), eq(uiWorkspaces.orgId, orgId)))
      .returning();
    return result[0] || null;
  }

  async deleteWorkspace(id: string, orgId: string, ctx?: RepositoryContext) {
    const exec = this.getExecutor(ctx);
    const result = await exec
      .delete(uiWorkspaces)
      .where(and(eq(uiWorkspaces.id, id), eq(uiWorkspaces.orgId, orgId)))
      .returning();
    return result[0] || null;
  }

  async listAvailableConnections(
    orgId: string,
    workspaceEnvType: 'PRODUCTION' | 'SANDBOX',
    workspaceId: string,
    ctx?: RepositoryContext,
  ) {
    const exec = this.getExecutor(ctx);
    const assigned = await exec
      .select({ dataSourceId: uiWorkspaceDataSources.dataSourceId })
      .from(uiWorkspaceDataSources)
      .where(eq(uiWorkspaceDataSources.workspaceId, workspaceId));

    const assignedIds = assigned.map((r) => r.dataSourceId);

    const conditions = [
      eq(dataSources.tenantId, orgId),
      eq(credentials.status, AppConnectionStatus.ACTIVE),
      eq(dataSources.envType, workspaceEnvType),
    ];

    if (assignedIds.length > 0) {
      conditions.push(notInArray(dataSources.id, assignedIds));
    }

    return exec
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

  async listConnections(
    orgId: string,
    workspaceEnvType: 'PRODUCTION' | 'SANDBOX',
    ctx?: RepositoryContext,
  ) {
    const exec = this.getExecutor(ctx);
    return exec
      .select({
        id: dataSources.id,
        appName: dataSources.appName,
        externalId: dataSources.externalId,
        displayName: dataSources.displayName,
        authType: credentials.authType,
        status: credentials.status,
        assignedAt: dataSources.createdAt,
      })
      .from(dataSources)
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
        and(
          eq(dataSources.tenantId, orgId),
          eq(dataSources.envType, workspaceEnvType),
        ),
      )
      .orderBy(asc(dataSources.createdAt));
  }

  /**
   * Find a connection by ID that belongs to the org. Returns null if not found.
   * Used for workspace assignment validation — deliberately excludes credential value.
   */
  async findConnectionForAssignment(
    dataSourceId: string,
    orgId: string,
    ctx?: RepositoryContext,
  ) {
    const exec = this.getExecutor(ctx);
    const [row] = await exec
      .select({ id: dataSources.id, envType: dataSources.envType })
      .from(dataSources)
      .where(
        and(eq(dataSources.id, dataSourceId), eq(dataSources.tenantId, orgId)),
      )
      .limit(1);
    return row ?? null;
  }

  /** Find a connection scoped to the workspace envType — used by sync endpoint. */
  async findConnectionForSync(
    dataSourceId: string,
    orgId: string,
    workspaceEnvType: 'PRODUCTION' | 'SANDBOX',
    ctx?: RepositoryContext,
  ) {
    const exec = this.getExecutor(ctx);
    const [row] = await exec
      .select({ id: dataSources.id })
      .from(dataSources)
      .where(
        and(
          eq(dataSources.id, dataSourceId),
          eq(dataSources.tenantId, orgId),
          eq(dataSources.envType, workspaceEnvType),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Assign a connection to a workspace.
   * Returns the assignment row, or throws ConflictException on duplicate.
   */
  async assignConnection(
    workspaceId: string,
    dataSourceId: string,
    ctx?: RepositoryContext,
  ) {
    const exec = this.getExecutor(ctx);
    try {
      const [assignment] = await exec
        .insert(uiWorkspaceDataSources)
        .values({ workspaceId, dataSourceId })
        .returning();
      return assignment;
    } catch (err: unknown) {
      if (isUniqueViolation(err)) return null; // caller decides exception type
      throw err;
    }
  }

  /** Remove a workspace→connection assignment. */
  async unassignConnection(
    workspaceId: string,
    dataSourceId: string,
    ctx?: RepositoryContext,
  ) {
    const exec = this.getExecutor(ctx);
    await exec
      .delete(uiWorkspaceDataSources)
      .where(
        and(
          eq(uiWorkspaceDataSources.workspaceId, workspaceId),
          eq(uiWorkspaceDataSources.dataSourceId, dataSourceId),
        ),
      );
  }
}
