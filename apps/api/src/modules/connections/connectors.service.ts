import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  HttpException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppCredentialError } from '@nexiom/credentials';
import { resolveOAuth2Url, PropertyType } from '@nexiom/piece-framework';
import type { OAuthCredentialBlob } from '@nexiom/credentials';
import type { OAuth2Auth } from '@nexiom/piece-framework';
import {
  appConnections,
  AppConnectionStatus,
  connectionStorageRegistry,
  globalEntityMap,
  DATABASE_CONNECTION,
  type DrizzleDb,
} from '@nexiom/database';
import { eq, and, or, sql } from 'drizzle-orm';
import { SchemaPlan } from '@nexiom/dbmanager';
import type { DatabaseManager } from '@nexiom/dbmanager';
import { DB_MANAGER } from '../dbmanager/dbmanager.module.js';
import { PieceRegistryService } from '@nexiom/engine';
import * as crypto from 'node:crypto';
import { extractPgError, PG_UNIQUE_VIOLATION } from '../../shared/db.utils.js';

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

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly configService: ConfigService,
  ) {}

  private buildRedirectUri(): string {
    const rawBaseUrl =
      this.configService.get<string>('BASE_URL') || 'http://localhost:3000';
    const baseUrl = rawBaseUrl.replace(/\/+$/, '');
    return `${baseUrl}/api/connect/callback`;
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

    let authUrl: string;
    try {
      authUrl = resolveOAuth2Url(auth.authUrl, vendorParams);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid OAuth2 URL template',
      );
    }

    const url = new URL(authUrl);
    url.searchParams.append('response_type', 'code');
    url.searchParams.append('client_id', clientId);
    url.searchParams.append('state', state);

    if (auth.scope && auth.scope.length > 0) {
      url.searchParams.append('scope', auth.scope.join(' '));
    }

    url.searchParams.append('redirect_uri', this.buildRedirectUri());

    return url.toString();
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
      tokenUrl = resolveOAuth2Url(auth.tokenUrl, vendorParams);
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
    } catch (parseError) {
      this.logger.error(
        `Failed to parse token response from ${providerName} as JSON. Status: ${response.status}, Content-Type: ${response.headers.get('content-type')}`,
        parseError,
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

    const resolvedRegionContext = finalRegionContext || 'unknown';

    try {
      const workspaceProvisionInfo = await this.db.transaction(async (tx) => {
        // 1. Check if we're doing an explicit update via connectionId
        if (id) {
          let updated;
          try {
            [updated] = await tx
              .update(appConnections)
              .set({
                displayName,
                externalId,
                authType,
                value,
                expiresAt,
                metadata,
                status: AppConnectionStatus.ACTIVE,
                updatedAt: new Date(),
                ...(envType !== undefined && { envType }),
              })
              .where(
                and(
                  eq(appConnections.id, id),
                  eq(appConnections.tenantId, tenantId),
                  eq(appConnections.appName, providerName),
                ),
              )
              .returning({ id: appConnections.id });
          } catch (err: unknown) {
            const pgErr2 = extractPgError(err);
            this.throwOnDuplicateConnection(pgErr2, displayName, externalId);
            throw err;
          }

          if (!updated) {
            throw new NotFoundException(`Connection with ID ${id} not found.`);
          }
          return {
            connectionId: updated.id,
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
        await tx.execute(sql`SAVEPOINT before_unique_insert`);
        try {
          [connection] = await tx
            .insert(appConnections)
            .values({
              tenantId,
              appName: providerName,
              externalId,
              displayName,
              authType,
              value,
              expiresAt,
              metadata,
              envType: envType ?? 'PRODUCTION',
              status: AppConnectionStatus.PROVISIONING,
            })
            .returning({ id: appConnections.id });
          await tx.execute(sql`RELEASE SAVEPOINT before_unique_insert`);
        } catch (err: unknown) {
          const pgErr = extractPgError(err);
          // Roll back to savepoint so the transaction is back in a clean state
          // before we run additional queries (SELECT for FAILED reprovision, etc.)
          await tx.execute(sql`ROLLBACK TO SAVEPOINT before_unique_insert`);
          if (pgErr?.code === '23505') {
            // Identify the FAILED row based solely on the violated constraint,
            // not via OR(displayName, externalId). An OR lookup can revive the
            // wrong row when two different FAILED connections share one of the
            // caller's identifiers but not the other.
            let existingFailed: { id: string } | undefined;

            if (pgErr.constraint === 'tenant_app_display_name_lower_idx') {
              // displayName is the blocking duplicate — query only by displayName.
              const rows = await tx
                .select({ id: appConnections.id })
                .from(appConnections)
                .where(
                  and(
                    eq(appConnections.tenantId, tenantId),
                    eq(appConnections.appName, providerName),
                    sql`lower(${appConnections.displayName}) = lower(${displayName})`,
                    eq(appConnections.status, AppConnectionStatus.FAILED),
                  ),
                )
                .limit(1);
              existingFailed = rows[0];

              // Cross-check: only accept this FAILED row when externalId was
              // not supplied OR the externalId lookup resolves to the same row.
              // If externalId resolves to a *different* row (or no row at all),
              // clear existingFailed — both identifiers must agree on the same row.
              if (existingFailed && externalId) {
                const byExternalId = await tx
                  .select({ id: appConnections.id })
                  .from(appConnections)
                  .where(
                    and(
                      eq(appConnections.tenantId, tenantId),
                      eq(appConnections.appName, providerName),
                      eq(appConnections.externalId, externalId),
                      eq(appConnections.status, AppConnectionStatus.FAILED),
                    ),
                  )
                  .limit(1);
                if (
                  !byExternalId[0] ||
                  byExternalId[0].id !== existingFailed.id
                ) {
                  // externalId points to a different row or no FAILED row at all
                  existingFailed = undefined;
                }
              }
            } else if (
              pgErr.constraint === 'tenant_external_id_unique_idx' &&
              externalId
            ) {
              // externalId is the blocking duplicate — query only by externalId.
              const rows = await tx
                .select({ id: appConnections.id })
                .from(appConnections)
                .where(
                  and(
                    eq(appConnections.tenantId, tenantId),
                    eq(appConnections.appName, providerName),
                    eq(appConnections.externalId, externalId),
                    eq(appConnections.status, AppConnectionStatus.FAILED),
                  ),
                )
                .limit(1);
              existingFailed = rows[0];

              // Cross-check: only accept this FAILED row when the displayName
              // lookup resolves to the same row.
              // If displayName resolves to a *different* row (or no row at all),
              // clear existingFailed — both identifiers must agree on the same row.
              if (existingFailed) {
                const byDisplayName = await tx
                  .select({ id: appConnections.id })
                  .from(appConnections)
                  .where(
                    and(
                      eq(appConnections.tenantId, tenantId),
                      eq(appConnections.appName, providerName),
                      sql`lower(${appConnections.displayName}) = lower(${displayName})`,
                      eq(appConnections.status, AppConnectionStatus.FAILED),
                    ),
                  )
                  .limit(1);
                if (
                  !byDisplayName[0] ||
                  byDisplayName[0].id !== existingFailed.id
                ) {
                  // displayName points to a different row or no FAILED row at all
                  existingFailed = undefined;
                }
              }
            }

            if (existingFailed) {
              const [updated] = await tx
                .update(appConnections)
                .set({
                  authType,
                  value,
                  expiresAt,
                  metadata,
                  envType: envType ?? 'PRODUCTION',
                  status: AppConnectionStatus.PROVISIONING,
                  updatedAt: new Date(),
                })
                .where(eq(appConnections.id, existingFailed.id))
                .returning({ id: appConnections.id });

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

        // 2. Provision the Infrastructure Router (Storage Registry)
        const hashedSuffix = crypto
          .createHash('sha256')
          .update(connection.id)
          .digest('hex')
          .substring(0, 16);
        const sanitizedProvider = providerName.replaceAll(/[^a-z0-9]/g, '');
        const finalProviderToken = sanitizedProvider || 'unknown';
        const safeToken = finalProviderToken.substring(0, 40);
        const schemaName = `ws_${safeToken}_${hashedSuffix}`;

        const existingRegistry = await tx
          .select({ connectionId: connectionStorageRegistry.connectionId })
          .from(connectionStorageRegistry)
          .where(eq(connectionStorageRegistry.connectionId, connection.id))
          .limit(1);
        const createdRegistry = existingRegistry.length === 0;

        await tx
          .insert(connectionStorageRegistry)
          .values({
            connectionId: connection.id,
            dataNamespace: schemaName,
            databaseHostId: 'primary-cluster',
            regionContext: resolvedRegionContext,
          })
          .onConflictDoNothing({
            target: connectionStorageRegistry.connectionId,
          });

        return {
          schemaName,
          connectionId: connection.id,
          createdAppConnection: true,
          createdRegistry,
        };
      });

      if (!workspaceProvisionInfo.schemaName) {
        // If schemaName is empty, it means this was an explicit update and no new registry was created.
        return;
      }
      try {
        // At connection setup time, only provision the schema namespace.
        // The full table stack (gateway, replica, normalize, outbound) is
        // provisioned incrementally when a stitch/sync route is activated —
        // not during the OAuth handshake.
        await this.dbManager.applyPlan(
          workspaceProvisionInfo.schemaName,
          SchemaPlan.NAMESPACE_ONLY,
        );

        // Transition to ACTIVE only after namespace is successfully provisioned
        await this.db.transaction(async (tx) => {
          await tx
            .update(appConnections)
            .set({ status: AppConnectionStatus.ACTIVE })
            .where(eq(appConnections.id, workspaceProvisionInfo.connectionId));

          await tx
            .update(connectionStorageRegistry)
            .set({ schemaPlan: SchemaPlan.NAMESPACE_ONLY })
            .where(
              eq(
                connectionStorageRegistry.connectionId,
                workspaceProvisionInfo.connectionId,
              ),
            );
        });
      } catch (applyError) {
        this.logger.error(
          `Failed to provision namespace for connection ${workspaceProvisionInfo.connectionId} (schema: ${workspaceProvisionInfo.schemaName || 'unknown'}, provider: ${providerName})`,
          applyError,
        );
        try {
          await this.db.transaction(async (tx) => {
            if (workspaceProvisionInfo.createdRegistry) {
              // Intentionally keeping the registry to allow reprovisioning
            }
            if (workspaceProvisionInfo.createdAppConnection) {
              await tx
                .update(appConnections)
                .set({ status: AppConnectionStatus.FAILED })
                .where(
                  eq(appConnections.id, workspaceProvisionInfo.connectionId),
                );
            }
          });
        } catch (rollbackError) {
          this.logger.error(
            `Rollback transaction failed for ${providerName}`,
            rollbackError,
          );
        }

        if (workspaceProvisionInfo.schemaName) {
          try {
            await this.db.execute(
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
    connectionId: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Lock the parent connection row to prevent concurrent mapping inserts during verification
      const [lockedConn] = await tx
        .select({ id: appConnections.id })
        .from(appConnections)
        .where(
          and(
            eq(appConnections.id, connectionId),
            eq(appConnections.tenantId, tenantId),
          ),
        )
        .for('update')
        .limit(1);

      if (!lockedConn) {
        throw new NotFoundException(`Connection ${connectionId} not found`);
      }

      const [mapping] = await tx
        .select({ id: globalEntityMap.id })
        .from(globalEntityMap)
        .where(
          or(
            eq(globalEntityMap.sourceAppId, connectionId),
            eq(globalEntityMap.destAppId, connectionId),
          ),
        )
        .limit(1);

      if (mapping) {
        throw new ConflictException(
          'Cannot delete connection as it is currently in use. Please delete the associated integration stitches to remove these dependencies.',
        );
      }

      const deleted = await tx
        .delete(appConnections)
        .where(
          and(
            eq(appConnections.id, connectionId),
            eq(appConnections.tenantId, tenantId),
          ),
        )
        .returning();
      void deleted; // row was guaranteed by the earlier FOR UPDATE lock
    });
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
    if (pgErr.constraint === 'tenant_app_display_name_lower_idx') {
      throw new HttpException(
        `A connection named "${displayName}" already exists for this provider. Please choose a unique name.`,
        409,
      );
    }
    if (pgErr.constraint === 'tenant_external_id_unique_idx') {
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
