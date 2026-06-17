import {
  Injectable,
  Inject,
  InternalServerErrorException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  dataSources,
  credentials,
  AppConnectionStatus,
  globalRegistryOutbox,
  globalEntityMap,
} from '@soopa/database';
import type { DrizzleDb } from '@soopa/database';
import { eq, and, or, sql } from 'drizzle-orm';
import { DB_MANAGER, SchemaPlan } from '@soopa/dbmanager';
import type { DatabaseManager } from '@soopa/dbmanager';
import type { ConnectionLifecyclePort } from '../../core/ports/outbound/connection-lifecycle.port.js';
import type { ProvisionInfo } from '../../core/types/connection.types.js';
import type { StorageResolverPort } from '../../core/ports/outbound/storage-resolver.port.js';
import { PipelineStorageResolverAdapter } from './pipeline-storage-resolver.adapter.js';

@Injectable()
export class DrizzleConnectionLifecycleAdapter implements ConnectionLifecyclePort {
  private readonly logger = new Logger(DrizzleConnectionLifecycleAdapter.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    @Inject(PipelineStorageResolverAdapter)
    private readonly storageResolver: StorageResolverPort,
  ) {}

  async activateAndProvision(
    tenantId: string,
    workspaceProvisionInfo: ProvisionInfo,
    providerName: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!workspaceProvisionInfo.schemaName) {
      return;
    }

    try {
      await this.db.transaction(async (tx) => {
        const [activeConn] = await tx
          .update(dataSources)
          .set({ schemaPlan: SchemaPlan.STANDARD_ACTIVE })
          .where(eq(dataSources.id, workspaceProvisionInfo.dataSourceId))
          .returning();

        await tx
          .update(credentials)
          .set({ status: AppConnectionStatus.PROVISIONING })
          .where(
            eq(credentials.dataSourceId, workspaceProvisionInfo.dataSourceId),
          );

        await tx.insert(globalRegistryOutbox).values({
          tenantId: activeConn.tenantId,
          entityType: 'APP_CONNECTION',
          entityId: activeConn.id,
          action: 'UPSERT',
          payload: activeConn,
        });

        await tx.insert(globalRegistryOutbox).values({
          tenantId: activeConn.tenantId,
          entityType: 'SCHEMA_PROVISION',
          entityId: activeConn.id,
          action: 'APPLY',
          payload: {
            plan: SchemaPlan.STANDARD_ACTIVE,
            schemaName: workspaceProvisionInfo.schemaName,
            appName: providerName,
            appProfile: (metadata?.appProfile as string) || 'standard',
          },
        });
      });
    } catch (applyError) {
      this.logger.error(
        `Failed to provision namespace for connection ${workspaceProvisionInfo.dataSourceId}`,
        applyError instanceof Error ? applyError.stack : String(applyError),
      );
      try {
        if (workspaceProvisionInfo.createdAppConnection) {
          await this.db.transaction(async (tx) => {
            const [failedConn] = await tx
              .update(dataSources)
              .set({ updatedAt: new Date() })
              .where(eq(dataSources.id, workspaceProvisionInfo.dataSourceId))
              .returning();

            await tx
              .update(credentials)
              .set({ status: AppConnectionStatus.FAILED })
              .where(
                eq(
                  credentials.dataSourceId,
                  workspaceProvisionInfo.dataSourceId,
                ),
              );

            await tx.insert(globalRegistryOutbox).values({
              tenantId: failedConn.tenantId,
              entityType: 'APP_CONNECTION',
              entityId: failedConn.id,
              action: 'UPSERT',
              payload: failedConn,
            });
          });
        }
      } catch (rollbackError) {
        this.logger.error(`Rollback transaction failed`, rollbackError);
      }

      if (workspaceProvisionInfo.schemaName) {
        try {
          const tenantDb = await this.dbManager.getTenantDb(tenantId);
          await tenantDb.execute(
            sql`DROP SCHEMA IF EXISTS ${sql.identifier(workspaceProvisionInfo.schemaName)} CASCADE`,
          );
        } catch (dropError) {
          this.logger.error(`Failed to drop schema during rollback`, dropError);
        }
      }

      throw new InternalServerErrorException(
        'Failed to provision workspace namespace',
      );
    }
  }

  async safeTeardown(tenantId: string, dataSourceId: string): Promise<void> {
    const lockKey = `${tenantId}:${dataSourceId}`;
    const lockId = this.hashLockKey(lockKey);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockId})`);

      const [lockedConn] = await tx
        .select({ id: dataSources.id })
        .from(dataSources)
        .where(
          and(
            eq(dataSources.id, dataSourceId),
            eq(dataSources.tenantId, tenantId),
          ),
        )
        .for('update')
        .limit(1);

      if (!lockedConn) {
        throw new NotFoundException(`Connection ${dataSourceId} not found`);
      }

      try {
        const storageProfile =
          await this.storageResolver.resolveStorageProfile(dataSourceId);

        if (storageProfile.tenantId !== tenantId) {
          throw new ForbiddenException(`Cross-tenant access is not permitted.`);
        }

        const tenantDb = await this.dbManager.getTenantDb(tenantId);

        const [mapping] = await tenantDb
          .select({ id: globalEntityMap.id })
          .from(globalEntityMap)
          .where(
            or(
              eq(globalEntityMap.sourceDataSourceId, dataSourceId),
              eq(globalEntityMap.destDataSourceId, dataSourceId),
            ),
          )
          .limit(1);

        if (mapping) {
          throw new ConflictException(
            'Cannot delete connection as it is currently in use.',
          );
        }
      } catch (err) {
        if (err instanceof ConflictException) throw err;
        if (err instanceof ForbiddenException) throw err;

        const errMsg = err instanceof Error ? err.message : String(err);
        const pgCode =
          (err as { code?: string })?.code ||
          (err as { cause?: { code?: string } })?.cause?.code;

        if (
          pgCode === '3F000' ||
          pgCode === '42P01' ||
          (errMsg.includes('schema') &&
            (errMsg.includes('does not exist') ||
              errMsg.includes('not found'))) ||
          (errMsg.includes('relation') && errMsg.includes('does not exist'))
        ) {
          this.logger.warn(
            `Storage not fully provisioned, proceeding with deletion: ${errMsg}`,
          );
        } else {
          this.logger.error(
            `Failed to check GEM, aborting deletion: ${errMsg}`,
          );
          throw err;
        }
      }

      const [deletedConn] = await tx
        .delete(dataSources)
        .where(
          and(
            eq(dataSources.id, dataSourceId),
            eq(dataSources.tenantId, tenantId),
          ),
        )
        .returning();

      if (deletedConn) {
        await tx.insert(globalRegistryOutbox).values({
          tenantId: deletedConn.tenantId,
          entityType: 'APP_CONNECTION',
          entityId: deletedConn.id,
          action: 'DELETE',
          payload: deletedConn,
        });
      }
    });
  }

  private hashLockKey(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash | 0;
    }
    return Math.abs(hash);
  }
}
