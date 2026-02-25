import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProviderRegistryService,
  EncryptionService,
  AppCredentialError,
} from '@nexiom/connections';
import {
  appCredentials,
  withTenantGuard,
  type DrizzleDb,
} from '@nexiom/database';
import { eq } from 'drizzle-orm';

@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name);

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDb,
    private readonly crypto: EncryptionService,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly configService: ConfigService,
  ) {}

  private buildRedirectUri(): string {
    const baseUrl =
      this.configService.get<string>('BASE_URL') || 'http://localhost:3000';
    return `${baseUrl}/api/connect/callback`;
  }

  /**
   * Fetches the OAuth app credential for a given tenant and provider.
   * Extracts the database lookup logic into a shared helper to ensure RLS-like
   * tenant isolation is consistently applied at the application layer.
   */
  async fetchAppCredential(tenantId: string, providerName: string) {
    const [credential] = await this.db
      .select()
      .from(appCredentials)
      .where(
        withTenantGuard(
          appCredentials.tenantId,
          tenantId,
          eq(appCredentials.appName, providerName),
        ),
      );

    if (!credential) {
      this.logger.error(
        `Missing OAuth app credential for ${providerName} on tenant ${tenantId}`,
      );
      return null;
    }

    return credential;
  }

  async decryptClientSecret(
    encryptedSecret: string,
    providerName: string,
    tenantId: string,
  ): Promise<string> {
    try {
      return await this.crypto.decrypt(encryptedSecret);
    } catch {
      this.logger.error(
        `Failed to decrypt client secret for ${providerName} on tenant ${tenantId}`,
      );
      throw new AppCredentialError('Invalid connector configuration.');
    }
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

    if (provider.authType !== 'OAUTH2' || !provider.authorizeUrl) {
      this.logger.error(
        `Provider ${providerName} missing authorizeUrl or not an OAuth provider.`,
      );
      throw new InternalServerErrorException(
        `Provider ${providerName} configuration is incomplete for OAuth.`,
      );
    }

    if (!clientId) {
      throw new BadRequestException('clientId is required for authorization');
    }
    // Attempt to match the requested environment from the provider's defined environments array.
    const environmentConfig = provider.environments?.find(
      (e) => e.name === env,
    );

    // If an environment match is found, prefer its authorizeUrl. Otherwise, fallback to the root definition.
    const authorizeUrl =
      environmentConfig?.authorizeUrl ?? provider.authorizeUrl;

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

    if (provider.authType !== 'OAUTH2' || !provider.tokenUrl) {
      this.logger.error(
        `Provider ${providerName} does not have a tokenUrl defined.`,
      );
      throw new InternalServerErrorException(
        `Provider ${providerName} configuration is incomplete.`,
      );
    }

    const redirectUri = this.buildRedirectUri();

    try {
      this.logger.log(`Exchanging OAuth code for ${providerName}...`);
      // Resolve token URL dynamically based on environment, falling back to basic tokenUrl
      const environmentConfig = provider.environments?.find(
        (e) => e.name === env,
      );
      const tokenUrl = environmentConfig?.tokenUrl ?? provider.tokenUrl;

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

      const tokens = (await response.json()) as Record<string, unknown>;

      if (
        provider.authType === 'OAUTH2' &&
        'validateConnectResponse' in provider &&
        provider.validateConnectResponse
      ) {
        provider.validateConnectResponse(tokens);
      }

      return tokens;
    } catch (error) {
      if (
        error instanceof InternalServerErrorException ||
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
}
