import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  HttpException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  dataSources,
  credentials,
  AppConnectionStatus,
  DATABASE_CONNECTION,
  globalRegistryOutbox,
  type DrizzleDb,
  SAVEPOINT_MANAGER,
  type ISavePointManager,
} from '@soopa/database';
import { eq, and, sql } from 'drizzle-orm';
import { getWorkspaceSchemaName } from '@soopa/dbmanager';
import { ConnectionLifecycleService } from '../connection-lifecycle.service.js';
import {
  extractPgError,
  PG_UNIQUE_VIOLATION,
} from '../../../shared/db.utils.js';
import type { StoreOAuthConnectionOptions } from '../connectors.service.js';

@Injectable()
export class CredentialLinkingService {
  private readonly logger = new Logger(CredentialLinkingService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly configService: ConfigService,
    @Inject(SAVEPOINT_MANAGER)
    private readonly savepointManager: ISavePointManager,
    private readonly lifecycleService: ConnectionLifecycleService,
  ) {}

  /**
   * Persists an OAuth connection.
   * If `id` is provided, explicit update is intended (may throw 404 if not found).
   * If `id` is not provided, conflicts on `displayName` or `externalId` will throw a 409 Conflict.
   */
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
    regionContext,
  }: StoreOAuthConnectionOptions): Promise<void> {
    const finalRegionContext =
      regionContext || this.configService.get<string>('DEFAULT_REGION_CONTEXT');

    if (!finalRegionContext) {
      const nodeEnv = this.configService.get<string>('NODE_ENV');
      if (nodeEnv === 'production') {
        throw new InternalServerErrorException(
          'Region context is required for connection storage in production',
        );
      }
      this.logger.warn(
        `No regionContext provided and DEFAULT_REGION_CONTEXT not configured for connection "${displayName}" — defaulting to 'unknown'`,
      );
    }

    try {
      const workspaceProvisionInfo = await this.db.transaction(async (tx) => {
        // 1. Check if we're doing an explicit update via dataSourceId
        if (id) {
          let updated;
          try {
            const schemaNameForUpdate = getWorkspaceSchemaName(
              id,
              providerName,
            );
            [updated] = await tx
              .update(dataSources)
              .set({
                displayName,
                externalId,
                metadata,
                schemaName: schemaNameForUpdate,
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
            createdRegistry: false,
            schemaName: '',
            createdAppConnection: false,
          };
        }

        let connection;
        // Use a savepoint so that if the INSERT violates a uniqueness constraint, the
        // transaction can be rolled back to this point and remain usable for subsequent
        // queries. Without a savepoint, a failed INSERT leaves the transaction in an
        // "aborted" state and any further query — including the FAILED-connection SELECT
        // below — will also fail with "current transaction is aborted".
        // Compute the schema name once before the insert so it can be
        // persisted on the row — this is the single source of truth used
        // by all pipeline workers for schema routing.
        // It cannot be computed after the insert because we need the
        // connection.id, which Postgres returns via RETURNING.
        // We generate a deterministic UUID-shaped placeholder here and
        // replace it after the insert via the RETURNING id.
        // Strategy: insert first, then UPDATE schema_name in same tx.
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

          await tx.insert(credentials).values({
            dataSourceId: connection.id,
            authType,
            value,
            expiresAt,
            status: AppConnectionStatus.PROVISIONING,
          });

          // Persist schemaName immediately — it is immutable once set.
          const schemaNameToStore = getWorkspaceSchemaName(
            connection.id,
            providerName,
          );
          await tx
            .update(dataSources)
            .set({ schemaName: schemaNameToStore })
            .where(eq(dataSources.id, connection.id));

          // Set schemaName on connection object before emitting to outbox
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
          // Roll back to savepoint so the transaction is back in a clean state
          // before we run additional queries (SELECT for FAILED reprovision, etc.)
          await this.savepointManager.rollbackToSavepoint(
            tx,
            'before_unique_insert',
          );
          if (pgErr?.code === '23505') {
            // Identify the FAILED row based solely on the violated constraint,
            // not via OR(displayName, externalId). An OR lookup can revive the
            // wrong row when two different FAILED connections share one of the
            // caller's identifiers but not the other.
            let existingFailed: { id: string } | undefined;

            if (pgErr.constraint === 'ds_tenant_app_display_name_lower_idx') {
              // displayName is the blocking duplicate — query only by displayName.
              // Only consider FAILED rows for re-provisioning.
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

              // Cross-check: only accept this FAILED row if the new externalId
              // isn't already taken by a DIFFERENT connection.
              // If externalId resolves to a *different* row, clear existingFailed.
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
                if (
                  byExternalId[0] &&
                  byExternalId[0].id !== existingFailed.id
                ) {
                  // externalId is taken by a different row
                  existingFailed = undefined;
                }
              }
            } else if (
              pgErr.constraint === 'ds_tenant_external_id_idx' &&
              externalId
            ) {
              // externalId is the blocking duplicate — query only by externalId.
              // Only consider FAILED rows for re-provisioning.
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

              // Cross-check: only accept this FAILED row if the new displayName
              // isn't already taken by a DIFFERENT connection.
              // If displayName resolves to a *different* row, clear existingFailed.
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
                  // displayName is taken by a different row
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
                .returning();

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

              // Publish to global registry outbox (same as other write paths)
              await tx.insert(globalRegistryOutbox).values({
                tenantId: updated.tenantId,
                entityType: 'APP_CONNECTION',
                entityId: updated.id,
                action: 'UPSERT',
                payload: updated,
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
          throw new Error('Failed to retrieve connection ID after insert');
        }

        // 2. Compute the deterministic schema name for the Tenant Database
        const schemaName = getWorkspaceSchemaName(connection.id, providerName);

        return {
          schemaName,
          dataSourceId: connection.id,
          createdAppConnection: true,
        };
      });

      await this.lifecycleService.provisionNamespace(
        tenantId,
        workspaceProvisionInfo,
        providerName,
        metadata,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Failed to store connection "${displayName}" (${externalId}) for ${providerName}`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to save connection to database',
      );
    }
  }

  /**
   * Deletes an app_connection. Validates absence of global_entity_map references
   * to satisfy RESTRICT FK constraints, surfacing a clear error if mappings exist.
   */
  async deleteConnection(
    tenantId: string,
    dataSourceId: string,
  ): Promise<void> {
    await this.lifecycleService.teardownNamespace(tenantId, dataSourceId);
  }

  /**
   * Throws a 409 HttpException when the pg error represents a unique-constraint
   * violation on a known connection-uniqueness index. Returns without throwing
   * when the code is not '23505' or the constraint is unrecognized (re-throw
   * is left to the caller).
   */
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
    // Unrecognized unique constraint — still a conflict, not a 500.
    // Log the constraint name so it can be identified and given a proper message.
    this.logger.error(
      `Unrecognized unique constraint violation: "${pgErr.constraint ?? 'unknown'}" — treating as 409 Conflict`,
    );
    throw new HttpException(
      'A connection with these details already exists.',
      409,
    );
  }
}
