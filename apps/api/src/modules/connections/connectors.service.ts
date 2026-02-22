import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderRegistryService } from '@nexiom/connections';

@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name);

  constructor(
    private readonly providerRegistry: ProviderRegistryService,
    private readonly configService: ConfigService,
  ) {}

  private normalizeProviderEnvPrefix(providerName: string): string {
    return providerName.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  }

  /**
   * Generates the fully qualified Authorization URL for the vendor.
   * Redirects the user's browser to this URL to start the OAuth flow.
   */
  async getAuthorizationUrl(
    providerName: string,
    state: string,
  ): Promise<string> {
    if (!/^[a-z0-9-]+$/.test(providerName)) {
      throw new BadRequestException('Invalid provider name format');
    }

    const provider = await this.providerRegistry.getProvider(providerName);

    if (!provider) {
      throw new NotFoundException(
        `Provider ${providerName} is not supported or not found`,
      );
    }

    if (!provider.authorizeUrl) {
      this.logger.error(
        `Provider ${providerName} does not have an authorizeUrl defined.`,
      );
      throw new InternalServerErrorException(
        `Provider ${providerName} configuration is incomplete.`,
      );
    }

    // Attempt to load client credentials
    const normalizedEnvName = this.normalizeProviderEnvPrefix(providerName);
    const clientId = this.configService.get<string>(
      `${normalizedEnvName}_CLIENT_ID`,
    );

    if (!clientId) {
      this.logger.error(
        `Missing OAuth client ID for ${providerName} (${normalizedEnvName}_CLIENT_ID)`,
      );
      throw new InternalServerErrorException(
        `Server is missing credentials for ${providerName}`,
      );
    }

    const url = new URL(provider.authorizeUrl);
    url.searchParams.append('response_type', 'code');
    url.searchParams.append('client_id', clientId);
    url.searchParams.append('state', state);

    if (provider.scopes && provider.scopes.length > 0) {
      // Vendors usually delimit scopes by space, but some require commas.
      // Assuming space as standard OAuth2 practice for now.
      url.searchParams.append('scope', provider.scopes.join(' '));
    }

    // Default system callback redirect URI. Depending on environment, we might
    // need a centralized config service for the hostname.
    const baseUrl =
      this.configService.get<string>('BASE_URL') || 'http://localhost:3000';
    url.searchParams.append(
      'redirect_uri',
      `${baseUrl}/api/connect/${providerName}/callback`,
    );

    return url.toString();
  }

  /**
   * Exchanges the OAuth authorization code for real access and refresh tokens.
   */
  async exchangeCodeForTokens(
    providerName: string,
    code: string,
  ): Promise<Record<string, unknown>> {
    if (!/^[a-z0-9-]+$/.test(providerName)) {
      throw new BadRequestException('Invalid provider name format');
    }

    const provider = await this.providerRegistry.getProvider(providerName);

    if (!provider) {
      throw new NotFoundException(
        `Provider ${providerName} is not supported or not found`,
      );
    }

    if (!provider.tokenUrl) {
      this.logger.error(
        `Provider ${providerName} does not have a tokenUrl defined.`,
      );
      throw new InternalServerErrorException(
        `Provider ${providerName} configuration is incomplete.`,
      );
    }

    const normalizedEnvName = this.normalizeProviderEnvPrefix(providerName);
    const clientId = this.configService.get<string>(
      `${normalizedEnvName}_CLIENT_ID`,
    );
    const clientSecret = this.configService.get<string>(
      `${normalizedEnvName}_CLIENT_SECRET`,
    );

    if (!clientId || !clientSecret) {
      this.logger.error(`Missing OAuth client credentials for ${providerName}`);
      throw new InternalServerErrorException(
        `Server is missing credentials for ${providerName}`,
      );
    }

    const baseUrl =
      this.configService.get<string>('BASE_URL') || 'http://localhost:3000';
    const redirectUri = `${baseUrl}/api/connect/${providerName}/callback`;

    try {
      this.logger.log(`Exchanging OAuth code for ${providerName}...`);

      const response = await fetch(provider.tokenUrl, {
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

        this.logger.error(
          `Vendor Token Exchange Failed [${response.status}]: ${errorBody}`,
        );
        throw new InternalServerErrorException(
          `Failed to exchange code with ${providerName}`,
        );
      }

      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
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
