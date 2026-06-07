import { Injectable, Inject } from '@nestjs/common';
import {
  BaseRepository,
  RepositoryContext,
  dataSources,
  DATABASE_CONNECTION,
  SAVEPOINT_MANAGER,
  credentials,
  AppConnectionStatus,
} from '@soopa/database';
import type { DrizzleDb, ISavePointManager } from '@soopa/database';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import { getAdminRoleId, getOwnerRoleId } from '@soopa/identity/constants';
import { member } from '@soopa/database';
import { ForbiddenException } from '@nestjs/common';

@Injectable()
export class ConnectionRepository extends BaseRepository<typeof dataSources> {
  constructor(
    @Inject(DATABASE_CONNECTION) db: DrizzleDb,
    @Inject(SAVEPOINT_MANAGER) savepointManager: ISavePointManager,
  ) {
    super(db, savepointManager, dataSources);
  }

  async findActiveByTenant(
    tenantId: string,
    limit: number,
    offset: number,
    ctx?: RepositoryContext,
  ) {
    const exec = this.getExecutor(ctx);
    return exec
      .select()
      .from(dataSources)
      .innerJoin(credentials, eq(credentials.dataSourceId, dataSources.id))
      .where(
        and(
          eq(dataSources.tenantId, tenantId),
          eq(credentials.status, AppConnectionStatus.ACTIVE),
        ),
      )
      .orderBy(desc(dataSources.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async countByTenant(tenantId: string, ctx?: RepositoryContext) {
    const exec = this.getExecutor(ctx);
    const result = await exec
      .select({ count: count() })
      .from(dataSources)
      .where(eq(dataSources.tenantId, tenantId));
    return Number(result[0]?.count ?? 0);
  }

  async findByIdAndTenant(
    id: string,
    tenantId: string,
    ctx?: RepositoryContext,
  ) {
    const exec = this.getExecutor(ctx);
    const result = await exec
      .select()
      .from(dataSources)
      .where(and(eq(dataSources.id, id), eq(dataSources.tenantId, tenantId)))
      .limit(1);
    return result[0] || null;
  }

  async findActiveWithCredentialsByTenant(
    tenantId: string,
    limit: number,
    offset: number,
    ctx?: RepositoryContext,
  ) {
    const exec = this.getExecutor(ctx);
    const whereClause = and(
      eq(dataSources.tenantId, tenantId),
      eq(credentials.status, AppConnectionStatus.ACTIVE),
    );

    const [activeConnections, [countResult]] = await Promise.all([
      exec
        .select({
          id: dataSources.id,
          appName: dataSources.appName,
          externalId: dataSources.externalId,
          displayName: dataSources.displayName,
          authType: credentials.authType,
          status: credentials.status,
          envType: dataSources.envType,
          metadata: dataSources.metadata,
          expiresAt: credentials.expiresAt,
          createdAt: dataSources.createdAt,
          updatedAt: dataSources.updatedAt,
          hasCredentials: sql<boolean>`${credentials.value} IS NOT NULL`,
        })
        .from(dataSources)
        .innerJoin(credentials, eq(credentials.dataSourceId, dataSources.id))
        .where(whereClause)
        .orderBy(desc(dataSources.createdAt), desc(dataSources.id))
        .limit(limit)
        .offset(offset),

      exec
        .select({ count: count() })
        .from(dataSources)
        .innerJoin(credentials, eq(credentials.dataSourceId, dataSources.id))
        .where(whereClause),
    ]);

    return { activeConnections, total: Number(countResult?.count ?? 0) };
  }

  async getConnectionCredentials(
    dataSourceId: string,
    tenantId: string,
    ctx?: RepositoryContext,
  ) {
    const exec = this.getExecutor(ctx);
    const result = await exec
      .select({
        id: dataSources.id,
        value: credentials.value,
      })
      .from(dataSources)
      .innerJoin(credentials, eq(credentials.dataSourceId, dataSources.id))
      .where(
        and(
          eq(dataSources.id, dataSourceId),
          eq(dataSources.tenantId, tenantId),
        ),
      )
      .limit(1);
    return result[0] || null;
  }

  async findConnectionByAppAndTenant(
    id: string,
    tenantId: string,
    appName: string,
    ctx?: RepositoryContext,
  ) {
    const exec = this.getExecutor(ctx);
    const result = await exec
      .select({ externalId: dataSources.externalId })
      .from(dataSources)
      .where(
        and(
          eq(dataSources.id, id),
          eq(dataSources.tenantId, tenantId),
          eq(dataSources.appName, appName),
        ),
      )
      .limit(1);
    return result[0] || null;
  }

  async assertAdminOrOwner(
    userId: string,
    tenantId: string,
    ctx?: RepositoryContext,
  ): Promise<void> {
    const exec = this.getExecutor(ctx);
    const [orgMember] = await exec
      .select({ role: member.role })
      .from(member)
      .where(
        and(eq(member.userId, userId), eq(member.organizationId, tenantId)),
      )
      .limit(1);

    if (
      !orgMember ||
      (orgMember.role !== getAdminRoleId() &&
        orgMember.role !== getOwnerRoleId())
    ) {
      throw new ForbiddenException(
        'Only organization admins or owners can perform this action',
      );
    }
  }
}
