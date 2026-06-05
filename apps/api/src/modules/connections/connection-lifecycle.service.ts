import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import {
  dataSources,
  credentials,
  AppConnectionStatus,
  DATABASE_CONNECTION,
  globalRegistryOutbox,
  type DrizzleDb,
  globalEntityMap,
} from '@soopa/database';
import { eq, and, or, sql } from 'drizzle-orm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  CredentialInvalidatedEvent,
  CredentialDeletedEvent,
} from '@soopa/credentials';
import { ConnectionSchemaProvisionedEvent } from './events/connection-schema-provisioned.event.js';
import { ConnectionPausedEvent } from './events/connection-paused.event.js';
import { SchemaPlan } from '@soopa/dbmanager';
import type { DatabaseManager } from '@soopa/dbmanager';
import { DB_MANAGER } from '@soopa/dbmanager';
import { StorageResolverService } from '@soopa/engine';

export interface ProvisionInfo {
  schemaName: string;
  dataSourceId: string;
  createdAppConnection: boolean;
}

@Injectable()
export class ConnectionLifecycleService {
  private readonly logger = new Logger(ConnectionLifecycleService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    private readonly storageResolver: StorageResolverService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async provisionNamespace(
    tenantId: string,
    workspaceProvisionInfo: ProvisionInfo,
    providerName: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!workspaceProvisionInfo.schemaName) {
      // If schemaName is empty, it means this was an explicit update
      return;
    }

    try {
      // At connection setup time, provision L1→L3 pipeline tables so that
      // webhook ingestion and normalization work immediately — without
      // waiting for a stitch to be configured.
      // L4-L6 outbound tables are added when a stitch is activated.
      await this.dbManager.applyPlan(
        tenantId,
        workspaceProvisionInfo.schemaName,
        SchemaPlan.CANONICAL_ACTIVE,
        {
          appName: providerName,
          appProfile: (metadata?.appProfile as string) || 'standard',
        },
      );

      // Transition to ACTIVE only after namespace is successfully provisioned
      await this.db.transaction(async (tx) => {
        const [activeConn] = await tx
          .update(dataSources)
          .set({
            schemaPlan: SchemaPlan.CANONICAL_ACTIVE,
          })
          .where(eq(dataSources.id, workspaceProvisionInfo.dataSourceId))
          .returning();

        await tx
          .update(credentials)
          .set({ status: AppConnectionStatus.ACTIVE })
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
      });

      // Emit domain event after transaction completes successfully
      this.eventEmitter.emit(
        'connection.provisioned',
        new ConnectionSchemaProvisionedEvent(
          tenantId,
          workspaceProvisionInfo.dataSourceId,
          workspaceProvisionInfo.schemaName,
        ),
      );
    } catch (applyError) {
      this.logger.error(
        `Failed to provision namespace for connection ${workspaceProvisionInfo.dataSourceId} (schema: ${workspaceProvisionInfo.schemaName || 'unknown'}, provider: ${providerName})`,
        applyError instanceof Error ? applyError.stack : String(applyError),
      );
      try {
        // Only start a transaction if we actually created a connection
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
        this.logger.error(
          `Rollback transaction failed for ${providerName}`,
          rollbackError,
        );
      }

      if (workspaceProvisionInfo.schemaName) {
        try {
          const tenantDb = await this.dbManager.getTenantDb(tenantId);
          await tenantDb.execute(
            sql`DROP SCHEMA IF EXISTS ${sql.identifier(workspaceProvisionInfo.schemaName)} CASCADE`,
          );
        } catch (dropError) {
          this.logger.error(
            `Failed to drop schema ${workspaceProvisionInfo.schemaName} during rollback for ${providerName}`,
            dropError,
          );
        }
      }

      throw new InternalServerErrorException(
        'Failed to provision workspace namespace',
      );
    }
  }

  async teardownNamespace(
    tenantId: string,
    dataSourceId: string,
  ): Promise<void> {
    // Acquire Postgres advisory lock to prevent race conditions during check-and-delete
    const lockKey = `${tenantId}:${dataSourceId}`;
    const lockId = this.hashLockKey(lockKey);

    await this.db.transaction(async (tx) => {
      // Acquire advisory lock for the entire check-and-delete sequence
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockId})`);

      // ── Step 1: Verify connection exists and lock it (global DB) ─────────────
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

      // ── Step 2: Check GEM in the tenant database ─────────────────────────────
      // GEM is data-plane data stored in the tenant control-plane public schema.
      try {
        const storageProfile =
          await this.storageResolver.resolveStorageProfile(dataSourceId);

        // Verify that the resolved storage profile belongs to the correct tenant
        if (storageProfile.tenantId !== tenantId) {
          throw new ForbiddenException(
            `Connection ${dataSourceId} belongs to tenant ${storageProfile.tenantId}, ` +
              `but was accessed in the context of tenant ${tenantId}. ` +
              `Cross-tenant access is not permitted.`,
          );
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
            'Cannot delete connection as it is currently in use. Please delete the associated integration stitches to remove these dependencies.',
          );
        }
      } catch (err) {
        // Re-throw ConflictException and ForbiddenException; these are security/business rule violations
        if (err instanceof ConflictException) throw err;
        if (err instanceof ForbiddenException) throw err;

        // Only swallow "schema does not exist" or "relation does not exist" errors
        const errMsg = err instanceof Error ? err.message : String(err);

        // Drizzle may wrap the Postgres error, so we check both the top-level code and the cause's code
        const pgCode =
          (err as { code?: string })?.code ||
          (err as { cause?: { code?: string } })?.cause?.code;

        if (
          pgCode === '3F000' || // invalid_schema_name
          pgCode === '42P01' || // undefined_table
          (errMsg.includes('schema') &&
            (errMsg.includes('does not exist') ||
              errMsg.includes('not found'))) ||
          (errMsg.includes('relation') && errMsg.includes('does not exist'))
        ) {
          this.logger.warn(
            `Storage not fully provisioned for connection ${dataSourceId} — proceeding with deletion: ${errMsg}`,
          );
        } else {
          // Transient failures or unexpected errors should abort deletion
          this.logger.error(
            `Failed to check GEM for connection ${dataSourceId} — aborting deletion: ${errMsg}`,
          );
          throw err;
        }
      }

      // ── Step 3: Delete the connection from global DB ──────────────────────────
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

  /**
   * Hashes a string key into a stable 32-bit integer for pg_advisory_lock.
   */
  private hashLockKey(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  @OnEvent('credential.invalidated')
  async handleCredentialInvalidated(
    event: CredentialInvalidatedEvent,
  ): Promise<void> {
    this.logger.warn(
      `Credential Invalidated [${event.credentialId}] due to: ${event.reason}`,
    );

    try {
      await this.db.transaction(async (tx) => {
        // Pause all dataSources related to this externalId/appName combo.
        // The token-refresh service passes externalId as the credentialId.
        const updatedConns = await tx
          .update(dataSources)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(dataSources.externalId, event.credentialId),
              eq(dataSources.appName, event.providerId),
            ),
          )
          .returning();

        // Iterate over all returned connections
        for (const updatedConn of updatedConns) {
          await tx
            .update(credentials)
            .set({ status: AppConnectionStatus.FAILED })
            .where(eq(credentials.dataSourceId, updatedConn.id));

          await tx.insert(globalRegistryOutbox).values({
            tenantId: updatedConn.tenantId,
            entityType: 'APP_CONNECTION',
            entityId: updatedConn.id,
            action: 'UPSERT',
            payload: updatedConn,
          });

          this.eventEmitter.emit(
            'connection.paused',
            new ConnectionPausedEvent(
              updatedConn.id,
              updatedConn.tenantId,
              event.reason,
            ),
          );
        }
      });
    } catch (err) {
      this.logger.error(
        `Failed to handle credential invalidation for ${event.credentialId}`,
        err,
      );
    }
  }

  @OnEvent('credential.deleted')
  handleCredentialDeleted(event: CredentialDeletedEvent): void {
    this.logger.log(
      `Credential Deleted [${event.credentialId}] for data source ${event.dataSourceId}.`,
    );
    // Depending on requirements, we might need to delete the connection here as well
    // if the credential was deleted directly (e.g. via an API call bypassing connection deletion).
  }
}
