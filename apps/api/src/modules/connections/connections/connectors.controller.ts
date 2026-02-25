import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Inject,
  InternalServerErrorException,
  BadRequestException,
  Query,
  Logger,
  Res,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';
import {
  AuthContext,
  RequestAuthContext,
} from '../../identity/auth/auth-context.decorator';
import {
  ProviderRegistryService,
  EncryptionService,
  AppCredentialError,
} from '@nexiom/connections';
import { ConnectorsService } from '../connectors.service';
import { OauthStateService } from '../oauth-state.service';
import {
  appConnections,
  AppConnectionStatus,
  type DrizzleDb,
} from '@nexiom/database';
import { eq, and, count } from 'drizzle-orm';
import { AuthGuard } from '../../identity/auth/auth.guard';

/** Converts a human-readable display name to a URL-safe kebab slug used as externalId */
function toKebabSlug(displayName: string): string {
  return displayName
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

@Controller('connectors')
@UseGuards(AuthGuard)
export class ConnectorsController {
  private readonly logger = new Logger(ConnectorsController.name);

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDb,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly connectorsService: ConnectorsService,
    private readonly oauthStateService: OauthStateService,
    private readonly crypto: EncryptionService,
  ) {}

  @Get('providers')
  getProviders() {
    try {
      const providers = this.providerRegistry.getAllProviders();
      return providers.map((p) => ({
        name: p.name,
        displayName: p.displayName,
        description: p.description,
        logoUrl: p.logoUrl,
        authType: p.authType,
        category: p.category,
        environments: 'environments' in p ? p.environments : undefined,
      }));
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('Failed to get providers', error.stack);
      } else {
        this.logger.error('Failed to get providers', String(error));
      }
      throw new InternalServerErrorException('Failed to get providers');
    }
  }

  @Get('active')
  async getActiveConnections(
    @AuthContext() ctx: RequestAuthContext,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const tenantId = ctx.user?.organizationId;
    if (!tenantId) {
      throw new BadRequestException('tenantId context is missing');
    }

    let limit = Number.parseInt(limitStr || '50', 10);
    if (Number.isNaN(limit) || !Number.isFinite(limit) || limit <= 0) {
      limit = 50;
    }
    limit = Math.min(limit, 100);

    let offset = Number.parseInt(offsetStr || '0', 10);
    if (Number.isNaN(offset) || !Number.isFinite(offset) || offset < 0) {
      offset = 0;
    }

    const whereClause = and(
      eq(appConnections.tenantId, tenantId),
      eq(appConnections.status, AppConnectionStatus.ACTIVE),
    );

    let activeConnections: {
      id: string;
      appName: string;
      externalId: string;
      displayName: string;
      authType: 'OAUTH2' | 'API_KEY' | 'BASIC';
      status: string;
      metadata: unknown;
      expiresAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }[];
    let countResult: { count: number | string } | undefined;

    try {
      [activeConnections, [countResult]] = await Promise.all([
        this.db
          .select({
            id: appConnections.id,
            appName: appConnections.appName,

            externalId: appConnections.externalId,

            displayName: appConnections.displayName,
            authType: appConnections.authType,
            status: appConnections.status,
            metadata: appConnections.metadata,
            expiresAt: appConnections.expiresAt,
            createdAt: appConnections.createdAt,
            updatedAt: appConnections.updatedAt,
          })
          .from(appConnections)
          .where(whereClause)
          .limit(limit)
          .offset(offset),

        this.db
          .select({ count: count() })
          .from(appConnections)
          .where(whereClause),
      ]);
    } catch (error) {
      const msg = `Failed to get active connections - tenantId=${tenantId}, limit=${limit}, offset=${offset}`;
      if (error instanceof Error) {
        this.logger.error(msg, error.stack);
      } else {
        this.logger.error(msg, String(error));
      }
      throw new InternalServerErrorException(
        'Failed to get active connections',
      );
    }

    const total = Number(countResult?.count ?? 0);

    return {
      data: activeConnections,
      metadata: { limit, offset, count: total },
    };
  }

  @Get(':providerName')
  initiateOAuth(
    @AuthContext() ctx: RequestAuthContext,
    @Query('clientId') clientId: string,
    @Query('env') env: string | undefined,
    @Res() res: Response,
    // providerName is validated below — extracted from the path via ctx.params
  ) {
    const providerName =
      (res.req.params as { providerName?: string }).providerName ?? '';
    const tenantId = ctx.user?.organizationId;

    if (!providerName || !/^[a-z0-9-]+$/.test(providerName)) {
      throw new BadRequestException('Invalid provider name format');
    }

    if (!tenantId) {
      throw new BadRequestException('tenantId context is missing');
    }

    if (!clientId || clientId.trim().length === 0) {
      throw new BadRequestException('clientId query parameter is required');
    }

    if (clientId.length > 512) {
      throw new BadRequestException('clientId exceeds maximum allowed length');
    }

    let authorizeUrl: string;
    try {
      const jwtState = this.oauthStateService.generateState(
        tenantId,
        providerName,
        env,
      );
      authorizeUrl = this.connectorsService.getAuthorizationUrl(
        providerName,
        jwtState,
        clientId,
        env,
      );
    } catch (error) {
      if (
        error instanceof HttpException ||
        error instanceof AppCredentialError
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to build authorization URL for ${providerName}`,
        error,
      );
      throw new InternalServerErrorException('Failed to initiate OAuth flow');
    }

    res.redirect(authorizeUrl);
  }

  @Post('oauth-exchange')
  async exchangeCode(
    @AuthContext() ctx: RequestAuthContext,
    @Body()
    body: {
      providerName: string;
      code: string;
      clientId: string;
      clientSecret: string;
      /** User-provided human-readable name e.g. "TMS Salesforce" */
      displayName: string;
      env?: string;
    },
  ) {
    const tenantId = ctx.user?.organizationId;
    if (!tenantId) {
      throw new BadRequestException('tenantId context is missing');
    }

    const { env, displayName, ...restOfBody } = body;

    if (
      !restOfBody.providerName ||
      !restOfBody.code ||
      !restOfBody.clientId ||
      !restOfBody.clientSecret
    ) {
      throw new BadRequestException('Missing required fields inside body');
    }

    if (!displayName || displayName.trim().length === 0) {
      throw new BadRequestException('displayName is required');
    }

    if (!/^[a-z0-9-]+$/.test(restOfBody.providerName)) {
      throw new BadRequestException('Invalid provider name format');
    }

    const providerData = this.providerRegistry.getProvider(
      restOfBody.providerName,
    );
    if (!providerData) {
      throw new BadRequestException('Invalid provider name');
    }

    // Exchange the code for actual OAuth tokens using user-provided credentials
    let tokenResponse: Record<string, unknown>;
    try {
      tokenResponse = await this.connectorsService.exchangeCodeForTokens(
        restOfBody.providerName,
        restOfBody.code,
        restOfBody.clientId,
        restOfBody.clientSecret,
        env,
      );
    } catch (error) {
      if (
        error instanceof HttpException ||
        error instanceof AppCredentialError
      ) {
        throw error;
      }
      this.logger.error(
        `Token exchange failed for ${restOfBody.providerName}`,
        error,
      );
      throw new InternalServerErrorException('Failed to exchange auth code');
    }

    if (!tokenResponse.access_token) {
      throw new BadRequestException('Invalid credentials returned from vendor');
    }

    // Build the Activepieces-style encrypted value blob:
    // Everything sensitive in one encrypted payload — clientId, secret, tokens, vendor-specific data
    const valueBlob = {
      clientId: restOfBody.clientId,
      clientSecret: restOfBody.clientSecret,
      accessToken: tokenResponse.access_token as string,
      refreshToken: tokenResponse.refresh_token as string | undefined,
      data: tokenResponse, // vendor-specific: instance_url, realmId, id_token, etc.
    };

    let encryptedValue: string;
    try {
      encryptedValue = await this.crypto.encrypt(JSON.stringify(valueBlob));
    } catch (error) {
      this.logger.error(
        `Encryption failed for ${restOfBody.providerName}`,
        error,
      );
      throw new InternalServerErrorException('Failed to encrypt credentials');
    }

    let parsedExpiresIn = 3600; // default 1 hour
    if (
      typeof tokenResponse.expires_in === 'number' &&
      tokenResponse.expires_in > 0
    ) {
      parsedExpiresIn = tokenResponse.expires_in;
    } else if (
      typeof tokenResponse.expires_in === 'string' &&
      Number.parseInt(tokenResponse.expires_in, 10) > 0
    ) {
      parsedExpiresIn = Number.parseInt(tokenResponse.expires_in, 10);
    }

    const MAX_EXPIRES_IN = 90 * 24 * 3600; // 90 days maximum
    const expiresIn = Math.min(parsedExpiresIn, MAX_EXPIRES_IN);
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // externalId is auto-derived from the user-supplied displayName
    const externalId = toKebabSlug(displayName);
    if (!externalId) {
      throw new BadRequestException(
        'displayName must contain at least one alphanumeric character',
      );
    }

    await this.connectorsService.storeOAuthConnection({
      tenantId,
      providerName: restOfBody.providerName,
      externalId,
      displayName: displayName.trim(),
      authType: providerData.authType,
      value: encryptedValue,
      expiresAt,
      metadata: { env },
    });

    this.logger.log(
      `[OAuth Exchange] Success: ${restOfBody.providerName} "${displayName}" (${externalId}) for tenant ${tenantId}`,
    );
    return { success: true };
  }
}
