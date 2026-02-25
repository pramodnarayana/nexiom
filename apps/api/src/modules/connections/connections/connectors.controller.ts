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
  Param,
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
} from '@nexiom/connections';
import { ConnectorsService } from '../connectors.service';
import { OauthStateService } from '../oauth-state.service';
import {
  appConnections,
  appCredentials,
  AppConnectionStatus,
  type DrizzleDb,
} from '@nexiom/database';
import { eq, and, count } from 'drizzle-orm';
import { AuthGuard } from '../../identity/auth/auth.guard';

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
      // Only return the necessary public info to the frontend
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

    let activeConnections;
    let countResult;

    try {
      [activeConnections, [countResult]] = await Promise.all([
        this.db
          .select({
            id: appConnections.id,
            appName: appConnections.appName,
            status: appConnections.status,
            metadata: appConnections.metadata,
            createdAt: appConnections.createdAt,
            updatedAt: appConnections.updatedAt,
            credentialClientId: appCredentials.clientId,
            credentialEncryptedSecret: appCredentials.encryptedClientSecret,
            credentialSetupMetadata: appCredentials.setupMetadata,
          })
          .from(appConnections)
          .leftJoin(
            appCredentials,
            and(
              eq(appConnections.tenantId, appCredentials.tenantId),
              eq(appConnections.appName, appCredentials.appName),
            ),
          )
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

    const decryptedConnections = activeConnections.map((conn) => {
      let env: string | undefined = undefined;

      if (
        typeof conn.credentialSetupMetadata === 'object' &&
        conn.credentialSetupMetadata !== null
      ) {
        // Extract the simple string env property saved from setup
        env = (conn.credentialSetupMetadata as Record<string, any>).env as
          | string
          | undefined;
      }

      return {
        id: conn.id,
        appName: conn.appName,
        status: conn.status,
        metadata: conn.metadata,
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt,
        credentials: conn.credentialClientId
          ? {
              clientId: conn.credentialClientId,
              env,
            }
          : undefined,
      };
    });

    return {
      data: decryptedConnections,
      metadata: { limit, offset, count: total },
    };
  }

  @Get(':provider')
  connect(
    @Param('provider') providerName: string,
    @AuthContext() ctx: RequestAuthContext,
    @Query('clientId') clientId: string,
    @Res() res: Response,
    @Query('realmId') realmId?: string,
    @Query('env') env?: string,
  ) {
    const tenantId = ctx.user?.organizationId;
    if (!tenantId) {
      throw new BadRequestException('tenantId context is missing');
    }
    if (!clientId) {
      throw new BadRequestException('clientId query parameter is required');
    }

    if (realmId) {
      if (realmId.length > 64 || !/^[a-zA-Z0-9-]+$/.test(realmId)) {
        this.logger.warn(
          `Invalid realmId format in connect for ${providerName}`,
        );
        throw new BadRequestException('Invalid realmId format');
      }
    }

    try {
      const state = this.oauthStateService.generateState(
        tenantId,
        providerName,
        realmId,
      );
      const url = this.connectorsService.getAuthorizationUrl(
        providerName,
        state,
        clientId,
        env,
      );

      // Redirect the user browser to the vendor's OAuth page
      return res.redirect(url);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Failed to initiate OAuth connect for ${providerName}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        `Failed to initiate OAuth connect for ${providerName}`,
      );
    }
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
      realmId?: string;
      env?: string;
    },
  ) {
    const tenantId = ctx.user?.organizationId;
    if (!tenantId) {
      throw new BadRequestException('tenantId context is missing');
    }

    const { env, realmId, ...restOfBody } = body;

    if (
      !restOfBody.providerName ||
      !restOfBody.code ||
      !restOfBody.clientId ||
      !restOfBody.clientSecret
    ) {
      throw new BadRequestException('Missing required fields inside body');
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
      this.logger.error(
        `Token exchange failed for ${restOfBody.providerName}`,
        error,
      );
      throw new InternalServerErrorException('Failed to exchange auth code');
    }

    if (!tokenResponse.access_token) {
      throw new BadRequestException('Invalid credentials returned from vendor');
    }

    // Prepare credentials for DB storage (similar to Activepieces "data" payload)
    const credentials = {
      accessToken: tokenResponse.access_token as string,
      refreshToken: tokenResponse.refresh_token as string | undefined,
      realmId, // e.g. for QuickBooks mapping
      data: tokenResponse, // vendor-specific properties like instance_url
    };

    let encryptedPayload: string;
    try {
      encryptedPayload = await this.crypto.encrypt(JSON.stringify(credentials));
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

    const connectionKey = realmId || 'default';

    // Store the activated connection into the Drizzle database mapping
    // Encrypt the Client Secret for the App Credential table
    let encryptedClientSecret: string;
    try {
      encryptedClientSecret = await this.crypto.encrypt(
        restOfBody.clientSecret,
      );
    } catch (error) {
      this.logger.error(
        `Failed to encrypt client secret for ${restOfBody.providerName}`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to encrypt app credentials',
      );
    }

    // Store the activated connection into the Drizzle database mapping
    await this.connectorsService.storeOAuthConnection(
      tenantId,
      restOfBody.providerName,
      connectionKey,
      providerData.authType,
      encryptedPayload,
      expiresAt,
      { realmId, env },
      restOfBody.clientId,
      encryptedClientSecret,
      env,
    );

    this.logger.log(
      `[OAuth Exchange] Success: ${restOfBody.providerName} for tenant ${tenantId}`,
    );
    return { success: true };
  }
}
