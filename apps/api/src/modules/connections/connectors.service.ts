import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProviderRegistryService,
  AppCredentialError,
  ProviderEnvironment,
} from '@nexiom/connectors';
import {
  appConnections,
  AppConnectionStatus,
  connectionStorageRegistry,
  DATABASE_CONNECTION,
  type DrizzleDb,
} from '@nexiom/database';
import { DatabaseManager, SchemaPlan } from '@nexiom/dbmanager';
import { DB_MANAGER } from '../dbmanager/dbmanager.module';
import * as crypto from 'node:crypto';

/** Encrypted value blob stored in app_connection.value — mirrors Activepieces BaseOAuth2ConnectionValue */
export interface ConnectionValueBlob {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken?: string;
  /** Vendor-specific extras: instance_url, realmId, id_token, etc. */
  data: Record<string, unknown>;
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
    private readonly providerRegistry: ProviderRegistryService,
    private readonly configService: ConfigService,
  ) {}

  private buildRedirectUri(): string {
    const rawBaseUrl =
      this.configService.get<string>('BASE_URL') || 'http://localhost:3000';
    const baseUrl = rawBaseUrl.replace(/\/+$/, '');
    return `${baseUrl}/api/connect/callback`;
  }

  /**
   * Generates the fully qualified Authorization URL for the vendor.
   * Redirects the user's browser to this URL to start the OAuth flow.
   */
  getAuthorizationUrl(
    providerName: string,
    state: string,
    clientId: string,
    env?: string,
  ): string {
    if (!/^[a-z0-9-]+$/.test(providerName)) {
      throw new BadRequestException('Invalid provider name format');
    }

    const provider = this.providerRegistry.getProvider(providerName);

    if (!provider) {
      throw new NotFoundException(
        `Provider ${providerName} is not supported or not found`,
      );
    }

    if (!clientId) {
      throw new BadRequestException('clientId is required for authorization');
    }
    if (provider.authType !== 'OAUTH2') {
      this.logger.error(`Provider ${providerName} is not an OAuth provider.`);
      throw new InternalServerErrorException(
        `Provider ${providerName} configuration is incomplete for OAuth.`,
      );
    }

    // Attempt to match the requested environment from the provider's defined environments array.
    let authorizeUrl: string | undefined;
    if (env) {
      const environmentConfig = provider.environments?.find(
        (envParam: ProviderEnvironment) => envParam.name === env,
      );
      if (!environmentConfig) {
        throw new BadRequestException(
          `Environment '${env}' is not configured for provider '${providerName}'`,
        );
      }
      authorizeUrl = environmentConfig.authorizeUrl;
    } else {
      authorizeUrl = provider.authorizeUrl;
    }

    if (!authorizeUrl) {
      this.logger.error(`Provider ${providerName} missing authorizeUrl.`);
      throw new InternalServerErrorException(
        `Provider ${providerName} configuration is incomplete for OAuth.`,
      );
    }

    const url = new URL(authorizeUrl);
    url.searchParams.append('response_type', 'code');
    url.searchParams.append('client_id', clientId);
    url.searchParams.append('state', state);

    if (provider.scopes && provider.scopes.length > 0) {
      // Vendors usually delimit scopes by space, but some require commas.
      // Assuming space as standard OAuth2 practice for now.
      url.searchParams.append('scope', provider.scopes.join(' '));
    }

    url.searchParams.append('redirect_uri', this.buildRedirectUri());

    return url.toString();
  }

  /**
   * Exchanges the OAuth authorization code for real access and refresh tokens.
   */
  async exchangeCodeForTokens(
    providerName: string,
    code: string,
    clientId: string,
    clientSecret: string,
    env?: string,
  ): Promise<Record<string, unknown>> {
    if (!/^[a-z0-9-]+$/.test(providerName)) {
      throw new BadRequestException('Invalid provider name format');
    }

    const provider = this.providerRegistry.getProvider(providerName);

    if (!provider) {
      throw new NotFoundException(
        `Provider ${providerName} is not supported or not found`,
      );
    }

    if (provider.authType !== 'OAUTH2') {
      this.logger.error(`Provider ${providerName} is not an OAuth provider.`);
      throw new InternalServerErrorException(
        `Provider ${providerName} configuration is incomplete.`,
      );
    }

    const redirectUri = this.buildRedirectUri();

    try {
      this.logger.log(`Exchanging OAuth code for ${providerName}...`);
      // Resolve token URL dynamically based on environment
      let tokenUrl: string | undefined;
      if (env) {
        const environmentConfig = provider.environments?.find(
          (envParam: ProviderEnvironment) => envParam.name === env,
        );
        if (!environmentConfig) {
          throw new BadRequestException(
            `Environment '${env}' is not configured for provider '${providerName}'`,
          );
        }
        tokenUrl = environmentConfig.tokenUrl;
      } else {
        tokenUrl = provider.tokenUrl;
      }

      if (!tokenUrl) {
        this.logger.error(
          `Provider ${providerName} does not have a tokenUrl defined. Resolved to: ${tokenUrl}`,
        );
        throw new InternalServerErrorException(
          `Provider ${providerName} configuration is incomplete.`,
        );
      }

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
        signal: AbortSignal.timeout(10000), // 10 second timeout protection
      });

      if (!response.ok) {
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

        this.logger.error(
          `Vendor Token Exchange Failed for ${providerName} [${response.status}]: ${sanitizedError}`,
        );
        throw new InternalServerErrorException(
          `Failed to exchange code with ${providerName}`,
        );
      }

      let tokens: Record<string, unknown>;
      try {
        tokens = (await response.json()) as Record<string, unknown>;
      } catch (parseError) {
        this.logger.error(
          `Failed to parse token response from ${providerName} as JSON. Status: ${response.status}, Content-Type: ${response.headers.get('content-type')}`,
          parseError,
        );
        throw new InternalServerErrorException(
          `Vendor ${providerName} returned an invalid response format that could not be parsed as JSON.`,
        );
      }

      if (
        'validateConnectResponse' in provider &&
        provider.validateConnectResponse
      ) {
        provider.validateConnectResponse(tokens);
      }

      return tokens;
    } catch (error) {
      if (
        error instanceof InternalServerErrorException ||
        error instanceof BadRequestException ||
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
        // If this is a new connection, it needs a physical place to live.
        // We generate a deterministic but unique schema name: e.g. ws_salesforce_abc123...
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
            databaseHostId: 'primary-cluster', // Can be parameterized later for regional sharding
            regionContext: finalRegionContext,
          })
          .onConflictDoNothing({
            target: connectionStorageRegistry.connectionId,
          }); // Already provisioned

        return schemaName;
      });

      // 3. Apply the initial schema plan (NAMESPACE_ONLY) outside the transaction
      // so the DDL runs on its own connection and does not silently escape the
      // Drizzle tx scope (db.$client vs the transaction's dedicated connection).
      await this.dbManager.applyPlan(
        workspaceSchemaName,
        SchemaPlan.NAMESPACE_ONLY,
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
}
