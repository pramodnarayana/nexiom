import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Inject,
  InternalServerErrorException,
  BadRequestException,
  NotFoundException,
  Query,
  Logger,
  Res,
  HttpException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthContext, type RequestAuthContext, AuthGuard } from '@nexiom/auth';
import {
  ProviderRegistryService,
  EncryptionService,
  AppCredentialError,
  AnyProperty,
} from '@nexiom/connectors';
import { ConnectorsService } from '../connectors.service.js';
import { OauthStateService } from '../oauth-state.service.js';
import {
  appConnections,
  AppConnectionStatus,
  DATABASE_CONNECTION,
  type DrizzleDb,
} from '@nexiom/database';
import { eq, and, count, desc } from 'drizzle-orm';
import { PieceRegistryService } from '../../trigger/piece-registry.service.js';
function assertPropValue(
  key: string,
  val: string | undefined,
  prop: AnyProperty,
): void {
  if (prop.required && (val === undefined || val === null || val === '')) {
    throw new BadRequestException(`Missing required vendor parameter: ${key}`);
  }
  if (val === undefined || val === null || val === '') return;
  if (String(prop.type) === 'NUMBER' && Number.isNaN(Number(val))) {
    throw new BadRequestException(`Parameter ${key} must be a number`);
  }
  const BOOLEAN_VALUES = new Set(['true', 'false', '1', '0']);
  if (String(prop.type) === 'CHECKBOX' && !BOOLEAN_VALUES.has(val)) {
    throw new BadRequestException(`Parameter ${key} must be a boolean`);
  }
}

function validateVendorParams(
  schema: Record<string, AnyProperty> | undefined,
  vendorParams: Record<string, string> | undefined,
  fallbackSchema?: Record<string, AnyProperty>,
): void {
  // Use the primary schema if provided, otherwise fall back to uiSchema-derived props.
  // This mirrors the same resolution logic used in getProviders so that
  // vendors with only p.uiSchema are validated correctly.
  const effectiveSchema = schema ?? fallbackSchema;
  if (!effectiveSchema) return;
  const params = vendorParams ?? {};

  // Reject keys not declared in the schema — prevents undeclared data reaching the value blob.
  const declaredKeys = new Set(Object.keys(effectiveSchema));
  for (const key of Object.keys(params)) {
    if (!declaredKeys.has(key)) {
      throw new BadRequestException(
        `Undeclared vendor parameter: "${key}" is not allowed`,
      );
    }
  }

  // Validate each declared field.
  for (const [key, prop] of Object.entries(effectiveSchema)) {
    assertPropValue(key, params[key], prop);
  }
}

/** Parses expires_in from a token response, returning seconds (default 3600). */
function parseExpiresIn(expiresIn: unknown): number {
  const DEFAULT = 3600;
  if (typeof expiresIn === 'number' && expiresIn > 0) return expiresIn;
  if (typeof expiresIn === 'string') {
    const parsed = Number.parseInt(expiresIn, 10);
    if (parsed > 0) return parsed;
  }
  return DEFAULT;
}

/** Extracts and validates the refresh_token from a token response. */
function extractRefreshToken(
  tokenResponse: Record<string, unknown>,
): string | undefined {
  const rt = tokenResponse.refresh_token;
  if (rt === undefined) return undefined;
  if (typeof rt !== 'string' || !rt.trim()) {
    throw new BadRequestException(
      'Invalid refresh_token format returned from vendor',
    );
  }
  return rt;
}

/** Converts a human-readable display name to a URL-safe kebab slug used as externalId */
function toKebabSlug(displayName: string): string {
  return displayName
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}
const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_EXTERNAL_ID_LENGTH = 100;

/** Validates required fields of the oauth-exchange body. Returns derived `trimmedDisplayName` and `externalId`. */
function validateExchangeBody(
  providerName: unknown,
  code: unknown,
  clientId: unknown,
  clientSecret: unknown,
  state: unknown,
  displayName: unknown,
): { trimmedDisplayName: string; externalId: string } {
  // Runtime type guards — reject non-string payloads before any string methods are called.
  // displayName is checked separately as it gets its own targeted error when blank.
  for (const [field, val] of [
    ['providerName', providerName],
    ['code', code],
    ['clientId', clientId],
    ['clientSecret', clientSecret],
    ['state', state],
  ] as [string, unknown][]) {
    if (typeof val !== 'string' || !val) {
      throw new BadRequestException(
        typeof val !== 'string'
          ? `Field "${field}" must be a string`
          : 'Missing required fields inside body',
      );
    }
  }
  if (typeof displayName !== 'string') {
    throw new BadRequestException('Field "displayName" must be a string');
  }
  // From here all values are confirmed strings.
  const safeProviderName = providerName as string;
  const safeDisplayName = displayName;
  if (!/^[a-z0-9-]+$/.test(safeProviderName)) {
    throw new BadRequestException('Invalid provider name format');
  }
  const trimmedDisplayName = safeDisplayName.trim();
  if (!trimmedDisplayName) {
    throw new BadRequestException('displayName is required');
  }
  if (trimmedDisplayName.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new BadRequestException(
      `displayName exceeds maximum length of ${MAX_DISPLAY_NAME_LENGTH} characters`,
    );
  }
  const externalId = toKebabSlug(`${safeProviderName}-${trimmedDisplayName}`);
  if (!externalId) {
    throw new BadRequestException(
      'displayName must contain at least one alphanumeric character',
    );
  }
  if (externalId.length > MAX_EXTERNAL_ID_LENGTH) {
    throw new BadRequestException(
      `Auto-generated externalId exceeds maximum length of ${MAX_EXTERNAL_ID_LENGTH} characters`,
    );
  }
  return { trimmedDisplayName, externalId };
}

/** Safely extracts the `env` string from a connection's JSON metadata blob. */
function parseEnvFromMetadata(metadata: unknown): string {
  if (!metadata) return '';
  try {
    const meta =
      typeof metadata === 'string'
        ? (JSON.parse(metadata) as Record<string, unknown>)
        : (metadata as Record<string, unknown>);
    return typeof meta.env === 'string' ? meta.env : '';
  } catch {
    return '';
  }
}

@Controller('connectors')
@UseGuards(AuthGuard)
export class ConnectorsController {
  private readonly logger = new Logger(ConnectorsController.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly pieceRegistry: PieceRegistryService,
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
        uiSchema:
          p.uiSchema ||
          (
            this.pieceRegistry.getPiece(p.name)?.auth as
              | { props?: Record<string, unknown> }
              | undefined
          )?.props,
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
      value: string | null;
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
            value: appConnections.value,
          })
          .from(appConnections)
          .where(whereClause)
          .orderBy(desc(appConnections.createdAt), desc(appConnections.id))
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

    const listConnections = activeConnections.map((conn) => {
      const hasCredentials = !!conn.value;
      return {
        id: conn.id,
        appName: conn.appName,
        externalId: conn.externalId,
        displayName: conn.displayName,
        authType: conn.authType,
        status: conn.status,
        metadata: conn.metadata,
        expiresAt: conn.expiresAt,
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt,
        hasCredentials,
      };
    });

    return {
      data: listConnections,
      metadata: { limit, offset, count: total },
    };
  }

  @Get('active/:id/credentials')
  async getConnectionCredentials(
    @AuthContext() ctx: RequestAuthContext,
    @Param('id', ParseUUIDPipe) connectionId: string,
  ) {
    const tenantId = ctx.user?.organizationId;
    if (!tenantId) {
      throw new BadRequestException('tenantId context is missing');
    }

    const [connection] = await this.db
      .select({
        id: appConnections.id,
        value: appConnections.value,
        metadata: appConnections.metadata,
      })
      .from(appConnections)
      .where(
        and(
          eq(appConnections.id, connectionId),
          eq(appConnections.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    let clientId = '';
    let hasClientSecret = false;

    if (connection.value) {
      try {
        const decrypted = await this.crypto.decrypt(connection.value);
        const parsed = JSON.parse(decrypted) as Record<string, unknown>;
        clientId = typeof parsed.clientId === 'string' ? parsed.clientId : '';
        hasClientSecret =
          typeof parsed.clientSecret === 'string' &&
          parsed.clientSecret.length > 0;

        // Emit a structured access audit log indicating that a connection's credentials were reconstructed
        this.logger.log({
          message: `User requested valid credentials payload for connection ${connection.id}`,
          action: 'ACCESS_CREDENTIALS',
          userId: ctx.user?.id,
          tenantId,
          connectionId: connection.id,
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `Failed to decrypt credentials for connection ${connection.id}: ${errMsg}`,
        );
        throw new InternalServerErrorException(
          'Failed to decrypt connection credentials',
        );
      }
    }

    // Extract env from metadata stored on the connection row.
    const env = parseEnvFromMetadata(connection.metadata);

    return {
      clientId,
      hasClientSecret,
      env,
    };
  }

  @Get(':providerName')
  initiateOAuth(
    @AuthContext() ctx: RequestAuthContext,
    @Param('providerName') providerName: string,
    @Query('clientId') clientId: string,
    @Query('env') env: string | undefined,
    @Res() res: Response,
  ) {
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
      state: string;
      /** User-provided human-readable name e.g. "TMS Salesforce" */
      displayName: string;
      env?: string;
      vendorParams?: Record<string, string>;
    },
  ) {
    const tenantId = ctx.user?.organizationId;
    if (!tenantId) {
      throw new BadRequestException('tenantId context is missing');
    }

    const { env, vendorParams, ...restOfBody } = body;

    const { trimmedDisplayName, externalId } = validateExchangeBody(
      restOfBody.providerName,
      restOfBody.code,
      restOfBody.clientId,
      restOfBody.clientSecret,
      body.state,
      body.displayName,
    );

    const providerData = this.providerRegistry.getProvider(
      restOfBody.providerName,
    );
    if (!providerData) {
      throw new BadRequestException('Invalid provider name');
    }

    const decodedState = this.oauthStateService.verifyState(
      body.state,
      restOfBody.providerName,
    );
    if (decodedState.tenantId !== tenantId) {
      throw new BadRequestException(
        'State token does not belong to this tenant',
      );
    }

    // STRICT VALIDATION: validate vendor params against the same schema source
    // that getProviders exposes (p.uiSchema takes priority, then piece.auth.props).
    const piece = this.pieceRegistry.getPiece(restOfBody.providerName);
    const authProps =
      piece?.auth && 'props' in piece.auth
        ? (piece.auth.props as Record<string, AnyProperty>)
        : undefined;
    const uiSchemaProps = providerData.uiSchema as
      | Record<string, AnyProperty>
      | undefined;
    validateVendorParams(uiSchemaProps, vendorParams, authProps);

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

    if (
      typeof tokenResponse.access_token !== 'string' ||
      !tokenResponse.access_token.trim()
    ) {
      throw new BadRequestException(
        'Invalid or missing access_token returned from vendor',
      );
    }

    const validRefreshToken = extractRefreshToken(tokenResponse);

    // Build the Activepieces-style encrypted value blob:
    // Everything sensitive in one encrypted payload — clientId, secret, tokens, vendor-specific data
    const valueBlob = {
      clientId: restOfBody.clientId,
      clientSecret: restOfBody.clientSecret,
      accessToken: tokenResponse.access_token,
      refreshToken: validRefreshToken,
      data: { ...vendorParams, ...tokenResponse }, // vendor-specific: instance_url, realmId, id_token, etc.
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

    const parsedExpiresIn = parseExpiresIn(tokenResponse.expires_in);

    const MAX_EXPIRES_IN = 90 * 24 * 3600; // 90 days maximum
    const expiresIn = Math.min(parsedExpiresIn, MAX_EXPIRES_IN);
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // NOTE: externalId and displayName bounds are checked earlier

    try {
      await this.connectorsService.storeOAuthConnection({
        tenantId,
        providerName: restOfBody.providerName,
        externalId,
        displayName: trimmedDisplayName,
        authType: providerData.authType,
        value: encryptedValue,
        expiresAt,
        metadata: { env },
      });
    } catch (error) {
      if (
        error instanceof HttpException ||
        error instanceof AppCredentialError
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to store connection "${trimmedDisplayName}" (${externalId}) for ${restOfBody.providerName}`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to save connection to database',
      );
    }

    this.logger.log(
      `[OAuth Exchange] Success: ${restOfBody.providerName} "${trimmedDisplayName}" (${externalId}) for tenant ${tenantId}`,
    );
    return { success: true };
  }
}
