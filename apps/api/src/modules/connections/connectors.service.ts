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
import {
  AppCredentialError,
  resolveOAuth2Url,
  PropertyType,
} from '@nexiom/connectors';
import type { OAuth2Auth } from '@nexiom/connectors';
import {
  appConnections,
  AppConnectionStatus,
  connectionStorageRegistry,
  DATABASE_CONNECTION,
  type DrizzleDb,
} from '@nexiom/database';
import { eq } from 'drizzle-orm';
import { SchemaPlan } from '@nexiom/dbmanager';
import type { DatabaseManager } from '@nexiom/dbmanager';
import { DB_MANAGER } from '../dbmanager/dbmanager.module.js';
import { PieceRegistryService } from '../trigger/piece-registry.service.js';
import * as crypto from 'node:crypto';

/** Encrypted value blob stored in app_connection.value — mirrors Activepieces BaseOAuth2ConnectionValue */
export interface ConnectionValueBlob {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken?: string;
  /** Vendor-specific extras: instance_url, realmId, id_token, etc. */
  data: Record<string, unknown>;
  /**
   * Vendor-specific auth parameters collected during the OAuth flow
   * (e.g. environment selection). Stored here so the reconnect form
   * can restore them without database round-trips.
   */
  vendorParams?: Record<string, string>;
}

export interface StoreOAuthConnectionOptions {
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

      const response = await fetch(tokenUrl, {
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
   * Persists an OAuth connection in a single upsert.
   * Conflicts on (tenantId, externalId) — updating the same named connection
   * refreshes its tokens and metadata (e.g. re-connect flow).
   */
  async storeOAuthConnection({
    tenantId,
    providerName,
    externalId,
    displayName,
    authType,
    value,
    expiresAt,
    metadata,
    regionContext,
  }: StoreOAuthConnectionOptions): Promise<void> {
    const finalRegionContext =
      regionContext || this.configService.get<string>('DEFAULT_REGION_CONTEXT');

    if (!finalRegionContext) {
      this.logger.error(
        `regionContext is missing and no DEFAULT_REGION_CONTEXT is configured`,
      );
      throw new InternalServerErrorException(
        'Infrastructure configuration error: missing region context',
      );
    }

    try {
      const workspaceSchemaName = await this.db.transaction(async (tx) => {
        // 1. Insert or update the business connection metadata
        const [connection] = await tx
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
            status: AppConnectionStatus.ACTIVE,
          })
          .onConflictDoUpdate({
            target: [appConnections.tenantId, appConnections.externalId],
            set: {
              authType,
              value,
              expiresAt,
              metadata,
              status: AppConnectionStatus.ACTIVE,
              updatedAt: new Date(),
            },
          })
          .returning({ id: appConnections.id });

        if (!connection) {
          throw new Error('Failed to retrieve connection ID after upsert');
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

        await tx
          .insert(connectionStorageRegistry)
          .values({
            connectionId: connection.id,
            workspaceId: schemaName,
            databaseHostId: 'primary-cluster',
            regionContext: finalRegionContext,
          })
          .onConflictDoNothing({
            target: connectionStorageRegistry.connectionId,
          });

        return { schemaName, connectionId: connection.id };
      });

      // 3. Apply the initial schema plan outside the transaction
      try {
        await this.dbManager.applyPlan(
          workspaceSchemaName.schemaName,
          SchemaPlan.NAMESPACE_ONLY,
        );
      } catch (applyError) {
        this.logger.error(
          `applyPlan failed for ${providerName}, rolling back records...`,
          applyError,
        );
        await this.db
          .delete(connectionStorageRegistry)
          .where(
            eq(
              connectionStorageRegistry.connectionId,
              workspaceSchemaName.connectionId,
            ),
          );
        await this.db
          .delete(appConnections)
          .where(eq(appConnections.id, workspaceSchemaName.connectionId));
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
}
