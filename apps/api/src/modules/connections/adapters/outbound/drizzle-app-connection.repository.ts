import {
  Injectable,
  Inject,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  SAVEPOINT_MANAGER,
  dataSources,
  credentials,
  AppConnectionStatus,
  globalRegistryOutbox,
} from '@soopa/database';
import type { DrizzleDb, ISavePointManager } from '@soopa/database';
import { eq, and, sql } from 'drizzle-orm';
import { getWorkspaceSchemaName } from '@soopa/dbmanager';
import {
  extractPgError,
  PG_UNIQUE_VIOLATION,
} from '../../../../shared/db.utils.js';
import type { AppConnectionRepositoryPort } from '../../core/ports/outbound/app-connection-repository.port.js';
import type {
  StoreOAuthConnectionOptions,
  ProvisionInfo,
} from '../../core/types/connection.types.js';

@Injectable()
export class DrizzleAppConnectionRepositoryAdapter implements AppConnectionRepositoryPort {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(SAVEPOINT_MANAGER)
    private readonly savepointManager: ISavePointManager,
  ) {}

  async storeOAuthConnection({
    id,
    tenantId,
    providerName,
    externalId,
    displayName,
    authType,
    value,
    expiresAt,
    metadata,
    envType,
  }: StoreOAuthConnectionOptions): Promise<ProvisionInfo> {
    return await this.db.transaction(async (tx) => {
      // Explicit update via id
      if (id) {
        let updated;
        try {
          [updated] = await tx
            .update(dataSources)
            .set({
              displayName,
              externalId,
              metadata,
              updatedAt: new Date(),
              ...(envType !== undefined && { envType }),
            })
            .where(
              and(
                eq(dataSources.id, id),
                eq(dataSources.tenantId, tenantId),
                eq(dataSources.appName, providerName),
              ),
            )
            .returning();

          if (updated) {
            await tx
              .insert(credentials)
              .values({
                dataSourceId: updated.id,
                authType,
                value,
                expiresAt,
                status: AppConnectionStatus.ACTIVE,
              })
              .onConflictDoUpdate({
                target: [credentials.dataSourceId],
                set: {
                  authType,
                  value,
                  expiresAt,
                  status: AppConnectionStatus.ACTIVE,
                  updatedAt: new Date(),
                },
              });
          }
        } catch (err: unknown) {
          const pgErr2 = extractPgError(err);
          this.throwOnDuplicateConnection(pgErr2, displayName, externalId);
          throw err;
        }

        if (!updated) {
          throw new NotFoundException(`Connection with ID ${id} not found.`);
        }

        await tx.insert(globalRegistryOutbox).values({
          tenantId: updated.tenantId,
          entityType: 'APP_CONNECTION',
          entityId: updated.id,
          action: 'UPSERT',
          payload: updated,
        });

        return {
          dataSourceId: updated.id,
          schemaName: '',
          createdAppConnection: false,
        };
      }

      // Insert new connection
      let connection;
      await this.savepointManager.createSavepoint(tx, 'before_unique_insert');
      try {
        [connection] = await tx
          .insert(dataSources)
          .values({
            tenantId,
            appName: providerName,
            externalId,
            displayName,
            metadata,
            envType: envType ?? 'PRODUCTION',
          })
          .returning();

        if (!connection) {
          throw new InternalServerErrorException(
            'Failed to retrieve connection ID after insert',
          );
        }

        await tx.insert(credentials).values({
          dataSourceId: connection.id,
          authType,
          value,
          expiresAt,
          status: AppConnectionStatus.PROVISIONING,
        });

        const schemaNameToStore = getWorkspaceSchemaName(
          connection.id,
          providerName,
        );
        await tx
          .update(dataSources)
          .set({ schemaName: schemaNameToStore })
          .where(eq(dataSources.id, connection.id));

        connection.schemaName = schemaNameToStore;

        await tx.insert(globalRegistryOutbox).values({
          tenantId: connection.tenantId,
          entityType: 'APP_CONNECTION',
          entityId: connection.id,
          action: 'UPSERT',
          payload: connection,
        });

        await this.savepointManager.releaseSavepoint(
          tx,
          'before_unique_insert',
        );
      } catch (err: unknown) {
        const pgErr = extractPgError(err);
        await this.savepointManager.rollbackToSavepoint(
          tx,
          'before_unique_insert',
        );
        if (pgErr?.code === '23505') {
          let existingFailed: { id: string } | undefined;

          if (pgErr.constraint === 'ds_tenant_app_display_name_lower_idx') {
            const rows = await tx
              .select({ id: dataSources.id, status: credentials.status })
              .from(dataSources)
              .innerJoin(
                credentials,
                eq(credentials.dataSourceId, dataSources.id),
              )
              .where(
                and(
                  eq(dataSources.tenantId, tenantId),
                  eq(dataSources.appName, providerName),
                  sql`lower(${dataSources.displayName}) = lower(${displayName})`,
                  eq(credentials.status, AppConnectionStatus.FAILED),
                ),
              )
              .limit(1);
            existingFailed = rows[0];

            if (existingFailed && externalId) {
              const byExternalId = await tx
                .select({ id: dataSources.id })
                .from(dataSources)
                .where(
                  and(
                    eq(dataSources.tenantId, tenantId),
                    eq(dataSources.appName, providerName),
                    eq(dataSources.externalId, externalId),
                  ),
                )
                .limit(1);
              if (byExternalId[0] && byExternalId[0].id !== existingFailed.id) {
                existingFailed = undefined;
              }
            }
          } else if (
            pgErr.constraint === 'ds_tenant_external_id_idx' &&
            externalId
          ) {
            const rows = await tx
              .select({ id: dataSources.id, status: credentials.status })
              .from(dataSources)
              .innerJoin(
                credentials,
                eq(credentials.dataSourceId, dataSources.id),
              )
              .where(
                and(
                  eq(dataSources.tenantId, tenantId),
                  eq(dataSources.appName, providerName),
                  eq(dataSources.externalId, externalId),
                  eq(credentials.status, AppConnectionStatus.FAILED),
                ),
              )
              .limit(1);
            existingFailed = rows[0];

            if (existingFailed) {
              const byDisplayName = await tx
                .select({ id: dataSources.id })
                .from(dataSources)
                .where(
                  and(
                    eq(dataSources.tenantId, tenantId),
                    eq(dataSources.appName, providerName),
                    sql`lower(${dataSources.displayName}) = lower(${displayName})`,
                  ),
                )
                .limit(1);
              if (
                byDisplayName[0] &&
                byDisplayName[0].id !== existingFailed.id
              ) {
                existingFailed = undefined;
              }
            }
          }

          if (existingFailed) {
            const recoveredSchemaName = getWorkspaceSchemaName(
              existingFailed.id,
              providerName,
            );
            const [updated] = await tx
              .update(dataSources)
              .set({
                displayName,
                externalId,
                metadata,
                envType: envType ?? 'PRODUCTION',
                schemaName: recoveredSchemaName,
                updatedAt: new Date(),
              })
              .where(eq(dataSources.id, existingFailed.id))
              .returning({ id: dataSources.id });

            await tx
              .insert(credentials)
              .values({
                dataSourceId: updated.id,
                authType,
                value,
                expiresAt,
                status: AppConnectionStatus.PROVISIONING,
              })
              .onConflictDoUpdate({
                target: [credentials.dataSourceId],
                set: {
                  authType,
                  value,
                  expiresAt,
                  status: AppConnectionStatus.PROVISIONING,
                  updatedAt: new Date(),
                },
              });

            connection = updated;
          } else {
            this.throwOnDuplicateConnection(pgErr, displayName, externalId);
          }
        } else {
          throw err;
        }
      }

      if (!connection) {
        throw new InternalServerErrorException(
          'Connection reference was lost during upsert',
        );
      }

      const schemaName = getWorkspaceSchemaName(connection.id, providerName);

      return {
        schemaName,
        dataSourceId: connection.id,
        createdAppConnection: true,
      };
    });
  }

  async deleteConnection(
    tenantId: string,
    dataSourceId: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
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

  private throwOnDuplicateConnection(
    pgErr: { code: string; constraint?: string } | null,
    displayName: string,
    externalId: string,
  ): void {
    if (pgErr?.code !== PG_UNIQUE_VIOLATION) return;
    if (pgErr.constraint === 'ds_tenant_app_display_name_lower_idx') {
      throw new HttpException(
        `A connection named "${displayName}" already exists for this provider. Please choose a unique name.`,
        409,
      );
    }
    if (pgErr.constraint === 'ds_tenant_external_id_idx') {
      throw new HttpException(
        `A connection with identifier "${externalId}" already exists in this organization. Please choose a unique name.`,
        409,
      );
    }
    throw new HttpException(
      'A connection with these details already exists.',
      409,
    );
  }
}
