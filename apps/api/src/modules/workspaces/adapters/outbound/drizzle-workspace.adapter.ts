import { Injectable, Inject, ConflictException } from '@nestjs/common';
import { eq, and, asc, inArray } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  uiWorkspaces,
  dataSources,
  credentials,
  AppConnectionStatus,
  globalRegistryOutbox,
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
      const workspace = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(uiWorkspaces)
          .values({
            orgId: params.orgId,
            name: params.name,
            envType: params.envType,
          })
          .returning();

        await tx.insert(globalRegistryOutbox).values({
          tenantId: params.orgId,
          entityType: 'UI_WORKSPACE',
          entityId: row.id,
          action: 'UPSERT',
          payload: row,
        });

        return row;
      });

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
      const updated = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(uiWorkspaces)
          .set({
            ...(params.name !== undefined && { name: params.name }),
            ...(params.envType !== undefined && { envType: params.envType }),
            updatedAt: new Date(),
          })
          .where(and(eq(uiWorkspaces.id, id), eq(uiWorkspaces.orgId, orgId)))
          .returning();

        if (row) {
          await tx.insert(globalRegistryOutbox).values({
            tenantId: orgId,
            entityType: 'UI_WORKSPACE',
            entityId: row.id,
            action: 'UPSERT',
            payload: row,
          });
        }

        return row || null;
      });

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

  async remove(orgId: string, id: string): Promise<WorkspaceRecord | null> {
    return this.db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(uiWorkspaces)
        .where(and(eq(uiWorkspaces.id, id), eq(uiWorkspaces.orgId, orgId)))
        .returning();

      if (deleted) {
        await tx.insert(globalRegistryOutbox).values({
          tenantId: orgId,
          entityType: 'UI_WORKSPACE',
          entityId: deleted.id,
          action: 'DELETE',
          payload: null,
        });
      }

      return deleted || null;
    });
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
}
