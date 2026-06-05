import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppCredentialError } from '@soopa/credentials';
import { PropertyType } from '@soopa/piece-framework';
import type { OAuthCredentialBlob } from '@soopa/credentials';
import type { OAuth2Auth } from '@soopa/piece-framework';
import { OAuthUrlBuilder } from './oauth-url-builder.js';
import {
  dataSources,
  credentials,
  AppConnectionStatus,
  DATABASE_CONNECTION,
  globalRegistryOutbox,
  type DrizzleDb,
} from '@soopa/database';
import { eq, and, sql } from 'drizzle-orm';
import { getWorkspaceSchemaName } from '@soopa/dbmanager';
import type { DatabaseManager } from '@soopa/dbmanager';
import { DB_MANAGER } from '@soopa/dbmanager';
import { StorageResolverService } from '@soopa/engine';
import { PieceRegistryService } from '@soopa/piece-registry';
import { extractPgError, PG_UNIQUE_VIOLATION } from '../../shared/db.utils.js';

import { SAVEPOINT_MANAGER, type ISavePointManager } from '@soopa/database';
import { ConnectionLifecycleService } from './connection-lifecycle.service.js';

/**
 * Encrypted value blob stored in app_connection.value.
 * Aliased from the credentials package so all callers share a single source of truth.
 */
export type ConnectionValueBlob = OAuthCredentialBlob;

export interface StoreOAuthConnectionOptions {
  id?: string;
  tenantId: string;
  providerName: string;
  /** User-defined kebab slug e.g. "salesforce-tms" — unique per tenant */
  externalId: string;
  /** Human-readable label e.g. "TMS Salesforce" */
  displayName: string;
  authType: 'OAUTH2' | 'API_KEY' | 'BASIC';
  /** JSON.stringify(ConnectionValueBlob), then encrypted */
  value: string;
  expiresAt: Date;
  metadata: Record<string, unknown>;
  /** Whether this connection targets a sandbox or production environment. Defaults to PRODUCTION. */
  envType?: 'PRODUCTION' | 'SANDBOX';
  /** Physical target region for database infrastructure mapping (optional) */
  regionContext?: string;
}

@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name);
  private readonly oauthUrlBuilder = new OAuthUrlBuilder();

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly configService: ConfigService,
    private readonly storageResolver: StorageResolverService,
    @Inject(SAVEPOINT_MANAGER)
    private readonly savepointManager: ISavePointManager,
    private readonly lifecycleService: ConnectionLifecycleService,
  ) {}

  private buildRedirectUri(): string {
    const rawBaseUrl =
      this.configService.get<string>('BASE_URL') || 'http://localhost:3000';
    return this.oauthUrlBuilder.buildRedirectUri(rawBaseUrl);
  }

  /**
   * Resolves the OAuth2 auth config from the piece registry.
   * Throws NotFoundException if the piece is not registered or is not an OAuth2 piece.
   */
  private resolveOAuth2Auth(providerName: string): OAuth2Auth {
    const piece = this.pieceRegistry.getPiece(providerName);
    if (!piece) {
      throw new NotFoundException(
        `Provider "${providerName}" is not registered`,
      );
    }
    if (piece.auth.type !== PropertyType.OAUTH2) {
      throw new BadRequestException(
        `Provider "${providerName}" does not use OAuth2 authentication`,
      );
    }
    return piece.auth;
  }

  /**
   * Returns the registered piece definition for the given provider name, or null if not found.
   * Used by the controller to look up auth.props for vendorParams schema validation.
   */
  getProviderDefinition(providerName: string) {
    return this.pieceRegistry.getPiece(providerName) ?? null;
  }

  /**
   * Generates the fully qualified Authorization URL for the vendor.
   * Redirects the user's browser to this URL to start the OAuth flow.
   *
   * vendorParams are used to resolve {key} template tokens in the piece's
   * authUrl (e.g. 'https://{environment}.salesforce.com/...').
   */
  getAuthorizationUrl(
    providerName: string,
    state: string,
    clientId: string,
    vendorParams: Record<string, string> = {},
  ): string {
    if (!clientId) {
      throw new BadRequestException('clientId is required for authorization');
    }

    const auth = this.resolveOAuth2Auth(providerName);

    if (!auth.authUrl) {
      throw new InternalServerErrorException(
        `Provider "${providerName}" missing OAuth2 authorizeUrl`,
      );
    }

    try {
      return this.oauthUrlBuilder.buildAuthorizationUrl({
        authUrl: auth.authUrl,
        clientId,
        state,
        redirectUri: this.buildRedirectUri(),
        scope: auth.scope,
        vendorParams,
      });
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid OAuth2 URL template',
      );
    }
  }

  /**
   * Exchanges the OAuth authorization code for real access and refresh tokens.
   *
   * vendorParams are used to resolve {key} template tokens in the piece's
   * tokenUrl (e.g. 'https://{environment}.salesforce.com/...').
   */
  async exchangeCodeForTokens(
    providerName: string,
    code: string,
    clientId: string,
    clientSecret: string,
    vendorParams: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const auth = this.resolveOAuth2Auth(providerName);

    if (!auth.tokenUrl) {
      throw new InternalServerErrorException(
        `Provider "${providerName}" missing OAuth2 tokenUrl`,
      );
    }

    let tokenUrl: string;
    try {
      tokenUrl = this.oauthUrlBuilder.resolveTemplatedUrl(
        auth.tokenUrl,
        vendorParams,
      );
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid OAuth2 URL template',
      );
    }

    const redirectUri = this.buildRedirectUri();

    try {
      this.logger.log(`Exchanging OAuth code for ${providerName}...`);

      const response = await this.executeTokenExchangeFetch(
        tokenUrl,
        redirectUri,
        clientId,
        clientSecret,
        code,
        providerName,
      );

      if (!response.ok) {
        await this.handleTokenExchangeError(providerName, response);
      }

      const tokens = await this.parseTokenResponse(providerName, response);

      if (auth.validateConnectResponse) {
        try {
          auth.validateConnectResponse(tokens);
        } catch (validationError) {
          throw new BadRequestException(
            validationError instanceof Error
              ? validationError.message
              : `Token validation failed for ${providerName}`,
          );
        }
      }

      return tokens;
    } catch (error) {
      this.handleExchangeException(providerName, error);
    }
  }

  private async handleTokenExchangeError(
    providerName: string,
    response: Response,
  ): Promise<never> {
    let errorBody = '';
    try {
      errorBody = await response.text();
    } catch {
      /* ignore parsing errors */
    }

    let sanitizedError = errorBody.replaceAll(/[\r\n]+/g, ' ').trim();
    if (sanitizedError.length > 500) {
      sanitizedError = sanitizedError.substring(0, 500) + '...(truncated)';
    }

    const errorMessage = `Vendor Token Exchange Failed for ${providerName} [${response.status}]: ${sanitizedError}`;
    this.logger.error(errorMessage);

    if (response.status === 400) {
      throw new BadRequestException(errorMessage);
    }
    if (response.status === 401) {
      throw new UnauthorizedException(errorMessage);
    }
    if (response.status >= 400 && response.status < 500) {
      throw new HttpException(errorMessage, response.status);
    }

    throw new InternalServerErrorException(
      `Failed to exchange code with ${providerName}`,
    );
  }

  private async parseTokenResponse(
    providerName: string,
    response: Response,
  ): Promise<Record<string, unknown>> {
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch (_parseError) {
      this.logger.error(
        `Failed to parse token response from ${providerName} as JSON. Status: ${response.status}, Content-Type: ${response.headers.get('content-type')}`,
        _parseError,
      );
      throw new InternalServerErrorException(
        `Vendor ${providerName} returned an invalid response format that could not be parsed as JSON.`,
      );
    }
  }

  private handleExchangeException(providerName: string, error: unknown): never {
    if (
      error instanceof InternalServerErrorException ||
      error instanceof BadRequestException ||
      error instanceof UnauthorizedException ||
      error instanceof HttpException ||
      error instanceof AppCredentialError
    ) {
      throw error;
    }
    this.logger.error(
      `Exception during OAuth token exchange for ${providerName}`,
      error,
    );
    throw new InternalServerErrorException(
      `Unexpected error during ${providerName} token exchange`,
    );
  }

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
                  // Re-persist schemaName on recovery — guards against rows that
                  // were inserted before this column existed (pre-migration rows).
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

  private async executeTokenExchangeFetch(
    tokenUrl: string,
    redirectUri: string,
    clientId: string,
    clientSecret: string,
    code: string,
    providerName: string,
  ): Promise<Response> {
    try {
      return await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
        signal: AbortSignal.timeout(10000),
      });
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || err.name === 'TimeoutError')
      ) {
        throw new InternalServerErrorException(
          `Token exchange timed out after 10s for ${providerName}`,
        );
      }
      throw err;
    }
  }
}
