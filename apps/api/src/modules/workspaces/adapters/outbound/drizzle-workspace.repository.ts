import { Injectable, Inject, ConflictException } from '@nestjs/common';
import { eq, and, asc, notInArray, inArray } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  uiWorkspaces,
  uiWorkspaceDataSources,
  dataSources,
  credentials,
  AppConnectionStatus,
} from '@soopa/database';
import { isUniqueViolation } from '../../../../shared/db.utils.js';
import type {
  WorkspaceRepositoryPort,
  CreateWorkspaceParams,
  UpdateWorkspaceParams,
  WorkspaceRecord,
  ConnectionRecord,
} from '../../core/ports/outbound/workspace-repository.port.js';

@Injectable()
export class DrizzleWorkspaceRepositoryAdapter implements WorkspaceRepositoryPort {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async create(params: CreateWorkspaceParams): Promise<WorkspaceRecord> {
    try {
      const [workspace] = await this.db
        .insert(uiWorkspaces)
        .values({
          orgId: params.orgId,
          name: params.name,
          envType: params.envType,
        })
        .returning();

      return workspace;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A ${params.envType} workspace named "${params.name}" already exists in this organisation.`,
        );
      }
      throw err;
    }
  }

  async list(orgId: string): Promise<WorkspaceRecord[]> {
    return this.db.query.uiWorkspaces.findMany({
      where: eq(uiWorkspaces.orgId, orgId),
      orderBy: [asc(uiWorkspaces.createdAt)],
    });
  }

  async findOne(orgId: string, id: string): Promise<WorkspaceRecord | null> {
    const workspace = await this.db.query.uiWorkspaces.findFirst({
      where: and(eq(uiWorkspaces.id, id), eq(uiWorkspaces.orgId, orgId)),
    });
    return workspace || null;
  }

  async update(
    orgId: string,
    id: string,
    params: UpdateWorkspaceParams,
  ): Promise<WorkspaceRecord | null> {
    try {
      const [updated] = await this.db
        .update(uiWorkspaces)
        .set({
          ...(params.name !== undefined && { name: params.name }),
          ...(params.envType !== undefined && { envType: params.envType }),
          updatedAt: new Date(),
        })
        .where(and(eq(uiWorkspaces.id, id), eq(uiWorkspaces.orgId, orgId)))
        .returning();

      return updated || null;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'Workspace with the provided identifier already exists.',
        );
      }
      throw err;
    }
  }

  async remove(orgId: string, id: string): Promise<WorkspaceRecord | null> {
    const [deleted] = await this.db
      .delete(uiWorkspaces)
      .where(and(eq(uiWorkspaces.id, id), eq(uiWorkspaces.orgId, orgId)))
      .returning();

    return deleted || null;
  }

  async listAvailableConnections(
    orgId: string,
    workspaceId: string,
  ): Promise<ConnectionRecord[]> {
    const workspace = await this.findOne(orgId, workspaceId);
    if (!workspace) return [];

    const assigned = await this.db
      .select({ dataSourceId: uiWorkspaceDataSources.dataSourceId })
      .from(uiWorkspaceDataSources)
      .where(eq(uiWorkspaceDataSources.workspaceId, workspaceId));

    const assignedIds = assigned.map((r) => r.dataSourceId);

    const conditions = [
      eq(dataSources.tenantId, orgId),
      eq(credentials.status, AppConnectionStatus.ACTIVE),
      eq(dataSources.envType, workspace.envType),
    ];

    if (assignedIds.length > 0) {
      conditions.push(notInArray(dataSources.id, assignedIds));
    }

    const rows = await this.db
      .select({
        id: dataSources.id,
        appName: dataSources.appName,
        externalId: dataSources.externalId,
        displayName: dataSources.displayName,
        authType: credentials.authType,
        status: credentials.status,
        envType: dataSources.envType,
        metadata: dataSources.metadata,
      })
      .from(dataSources)
      .innerJoin(credentials, eq(credentials.dataSourceId, dataSources.id))
      .where(and(...conditions))
      .orderBy(asc(dataSources.displayName));

    return rows.map((r) => ({
      ...r,
      envType: r.envType,
      metadata: r.metadata as Record<string, unknown> | null,
    }));
  }

  async listConnections(
    orgId: string,
    workspaceId: string,
  ): Promise<ConnectionRecord[]> {
    const workspace = await this.findOne(orgId, workspaceId);
    if (!workspace) return [];

    const rows = await this.db
      .select({
        id: dataSources.id,
        appName: dataSources.appName,
        externalId: dataSources.externalId,
        displayName: dataSources.displayName,
        authType: credentials.authType,
        status: credentials.status,
        envType: dataSources.envType,
        assignedAt: dataSources.createdAt,
        metadata: dataSources.metadata,
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
          eq(dataSources.envType, workspace.envType),
        ),
      )
      .orderBy(asc(dataSources.createdAt));

    return rows.map((r) => ({
      ...r,
      envType: r.envType,
      metadata: r.metadata as Record<string, unknown> | null,
    }));
  }

  async findConnectionForAssignment(
    dataSourceId: string,
    orgId: string,
  ): Promise<{ id: string; envType: 'PRODUCTION' | 'SANDBOX' } | null> {
    const [row] = await this.db
      .select({ id: dataSources.id, envType: dataSources.envType })
      .from(dataSources)
      .where(
        and(eq(dataSources.id, dataSourceId), eq(dataSources.tenantId, orgId)),
      )
      .limit(1);

    if (!row) return null;
    return {
      id: row.id,
      envType: row.envType,
    };
  }

  async findConnectionForSync(
    dataSourceId: string,
    orgId: string,
    envType: 'PRODUCTION' | 'SANDBOX',
  ): Promise<{ id: string } | null> {
    const [row] = await this.db
      .select({ id: dataSources.id })
      .from(dataSources)
      .where(
        and(
          eq(dataSources.id, dataSourceId),
          eq(dataSources.tenantId, orgId),
          eq(dataSources.envType, envType),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async assignConnection(
    workspaceId: string,
    dataSourceId: string,
  ): Promise<{ workspaceId: string; dataSourceId: string } | null> {
    try {
      const [assignment] = await this.db
        .insert(uiWorkspaceDataSources)
        .values({ workspaceId, dataSourceId })
        .returning();
      return assignment;
    } catch (err: unknown) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  async unassignConnection(
    workspaceId: string,
    dataSourceId: string,
  ): Promise<void> {
    await this.db
      .delete(uiWorkspaceDataSources)
      .where(
        and(
          eq(uiWorkspaceDataSources.workspaceId, workspaceId),
          eq(uiWorkspaceDataSources.dataSourceId, dataSourceId),
        ),
      );
  }
}
