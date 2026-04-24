import {
  Controller,
  Get,
  Post,
  Delete,
  HttpCode,
  HttpStatus,
  Body,
  UseGuards,
  Inject,
  InternalServerErrorException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Query,
  Logger,
  Res,
  HttpException,
  Param,
  ParseUUIDPipe,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';

import { AuthContext, type RequestAuthContext, AuthGuard } from '@nexiom/auth';
import { getAdminRoleId, getOwnerRoleId } from '@nexiom/identity/constants';
import { EncryptionService, AppCredentialError } from '@nexiom/credentials';
import type { AnyProperty } from '@nexiom/piece-framework';
import { ConnectorsService } from '../connectors.service.js';
import { OauthStateService } from '../oauth-state.service.js';
import {
  appConnections,
  AppConnectionStatus,
  DATABASE_CONNECTION,
  type DrizzleDb,
  member,
} from '@nexiom/database';
import { eq, and, count, desc } from 'drizzle-orm';
import { PieceRegistryService } from '@nexiom/piece-registry';
import type { ConnectionValueBlob } from '../connectors.service.js';
import { REDIS_CLIENT, type Redis } from '@nexiom/cache';
import { CreateOAuthSession } from '../validation/create-oauth-session.js';
import { ExchangeOAuthCode } from '../validation/exchange-oauth-code.js';
import { VALID_PROVIDER_NAME_REGEX } from '../validation/constants.js';

/**
 * Maps a provider's vendorParams to Nexiom's envType discriminator.
 *
 * Convention: pieces that support sandbox use an `environment` prop with value `'test'`
 * for sandbox and any other value (typically `'login'`) for production.
 * Pieces without an `environment` prop (single-environment) default to PRODUCTION.
 *
 * When adding a new piece that uses a different field or value, extend this function.
 */
function deriveEnvType(
  vendorParams: Record<string, string | number | boolean> | undefined,
): 'PRODUCTION' | 'SANDBOX' {
  return vendorParams?.environment === 'test' ? 'SANDBOX' : 'PRODUCTION';
}

function assertStaticDropdownValue(
  key: string,
  val: string,
  prop: AnyProperty,
): void {
  const p = prop as Record<string, unknown>;

  if (
    typeof p.options !== 'object' ||
    p.options === null ||
    !('options' in p.options) ||
    !Array.isArray((p.options as Record<string, unknown>).options)
  ) {
    throw new BadRequestException(`Parameter ${key} has malformed options`);
  }

  const opts = (p.options as Record<string, unknown>).options as Array<
    Record<string, unknown>
  >;

  const allowed = new Set(opts.map((o) => String(o.value)));
  if (!allowed.has(String(val))) {
    throw new BadRequestException(`Parameter ${key} has an invalid value`);
  }
}

function assertPropValue(
  key: string,
  val: string | number | boolean | undefined,
  prop: AnyProperty,
): void {
  if (prop.required && (val === undefined || val === null || val === '')) {
    throw new BadRequestException(`Missing required vendor parameter: ${key}`);
  }
  if (val === undefined || val === null || val === '') return;

  if (
    typeof val !== 'string' &&
    typeof val !== 'number' &&
    typeof val !== 'boolean'
  ) {
    throw new BadRequestException(
      `Parameter ${key} must be a primitive, received ${typeof val}`,
    );
  }

  if (
    String(prop.type) === 'NUMBER' &&
    typeof val !== 'number' &&
    Number.isNaN(Number(val))
  ) {
    throw new BadRequestException(`Parameter ${key} must be a number`);
  }
  const BOOLEAN_VALUES = new Set([
    'true',
    'false',
    '1',
    '0',
    true,
    false,
    1,
    0,
  ]);
  if (String(prop.type) === 'CHECKBOX' && !BOOLEAN_VALUES.has(val)) {
    throw new BadRequestException(`Parameter ${key} must be a boolean`);
  }
  if (String(prop.type) === 'STATIC_DROPDOWN') {
    assertStaticDropdownValue(key, String(val), prop);
  }
}

function parseConnectionCredentials(decrypted: string): {
  clientId: string;
  clientSecret: string;
  hasClientSecret: boolean;
  vendorParams?: Record<string, string>;
} {
  const parsed = JSON.parse(decrypted) as ConnectionValueBlob;

  const clientId = typeof parsed.clientId === 'string' ? parsed.clientId : '';
  const clientSecret =
    typeof parsed.clientSecret === 'string' ? parsed.clientSecret : '';
  const hasClientSecret = clientSecret.length > 0;

  let vendorParams: Record<string, string> | undefined;

  if (parsed.environment !== undefined && parsed.environment !== null) {
    vendorParams = { environment: String(parsed.environment) };
  }

  if (parsed.vendorParams && Object.keys(parsed.vendorParams).length > 0) {
    vendorParams = vendorParams || {};
    for (const [key, val] of Object.entries(parsed.vendorParams)) {
      if (!vendorParams[key] && val !== undefined && val !== null) {
        vendorParams[key] = String(val);
      }
    }
  }

  return { clientId, clientSecret, hasClientSecret, vendorParams };
}

function validateVendorParams(
  schema: Record<string, AnyProperty> | undefined,
  vendorParams: Record<string, string> | undefined,
): void {
  const params = vendorParams ?? {};
  const paramKeys = Object.keys(params);

  if (!schema) {
    if (paramKeys.length > 0) {
      throw new BadRequestException(
        'No vendor parameters are allowed for this provider',
      );
    }
    return;
  }

  // Check for any schema keys with required=true that are missing from params.
  const declaredKeys = new Set(Object.keys(schema));
  const missingKeys: string[] = [];
  for (const [key, prop] of Object.entries(schema)) {
    if (prop.required && !(key in params)) {
      missingKeys.push(key);
    }
  }
  if (missingKeys.length > 0) {
    throw new BadRequestException(
      `Missing required vendor parameters: ${missingKeys.join(', ')}`,
    );
  }

  // Reject keys not declared in the schema.
  for (const [key, val] of Object.entries(params)) {
    if (!declaredKeys.has(key)) {
      throw new BadRequestException(
        `Undeclared vendor parameter: "${key}" is not allowed`,
      );
    }
    // Validate each declared field using string assertions.
    assertPropValue(key, val, schema[key]);
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

import { randomBytes } from 'crypto';

/** Converts a human-readable display name to an enterprise-safe URL slug used as externalId */
function toKebabSlug(providerName: string, displayName: string): string {
  const baseSlug = displayName
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/(^-+)|(-+$)/g, '');

  const uniqueSuffix = randomBytes(2).toString('hex'); // 4 characters
  return `${providerName}-${baseSlug}-${uniqueSuffix}`;
}

const MAX_DISPLAY_NAME_LENGTH = 100;

@Controller('connectors')
@UseGuards(AuthGuard)
export class ConnectorsController {
  private readonly logger = new Logger(ConnectorsController.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly connectorsService: ConnectorsService,
    private readonly oauthStateService: OauthStateService,
    private readonly crypto: EncryptionService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Returns all registered pieces as provider descriptors.
   * The uiSchema is derived from piece.auth.props — the generic vendor-param
   * schema that DynamicAuthForm renders.
   */
  @Get('providers')
  getProviders() {
    try {
      const providers = this.pieceRegistry.getAllPieces().map((piece) => {
        const authProps =
          piece.auth && 'props' in piece.auth
            ? (piece.auth.props as Record<string, AnyProperty>)
            : undefined;

        return {
          name: piece.name,
          displayName: piece.displayName,
          description: piece.description,
          logoUrl: piece.logoUrl,
          authType: piece.auth.type,
          category: piece.categories?.[0] ?? 'Other',
          uiSchema: authProps,
        };
      });
      this.logger.debug(
        'GET PROVIDERS',
        providers.map((p) => p.name),
      );
      return providers;
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
      envType: 'PRODUCTION' | 'SANDBOX';
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
            envType: appConnections.envType,
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
        envType: conn.envType,
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

  /**
   * Returns re-connectable credentials for a stored connection.
   *
   * Returns:
   *  - clientId: the stored clientId (safe to expose)
   *  - hasClientSecret: whether a client secret was stored (never expose the secret itself)
   *  - vendorParams: all stored vendor-specific parameters (e.g. environment selection)
   *    so the reconnect form can pre-fill every uiSchema field generically
   */
  @Get('active/:id/credentials')
  async getConnectionCredentials(
    @AuthContext() ctx: RequestAuthContext,
    @Param('id', ParseUUIDPipe) connectionId: string,
  ) {
    const tenantId = ctx.user?.organizationId;
    if (!tenantId || !ctx.user?.id) {
      throw new BadRequestException('tenantId or user context is missing');
    }

    await this.assertAdminOrOwner(ctx.user.id, tenantId);

    const [connection] = await this.db
      .select({
        id: appConnections.id,
        value: appConnections.value,
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

    if (connection.value) {
      const creds = await this.decryptConnectionValue(
        connection.id,
        connection.value,
        ctx.user?.id,
        tenantId,
      );
      return creds;
    }

    return {
      clientId: '',
      hasClientSecret: false,
      vendorParams: undefined,
    };
  }

  private resolveVendorParams(
    providerDef: ReturnType<ConnectorsService['getProviderDefinition']>,
    rawParams: Record<string, string | number | boolean> | undefined,
  ): Record<string, string> {
    if (!rawParams) return {};

    const stringified: Record<string, string> = {};
    for (const [key, val] of Object.entries(rawParams)) {
      if (val !== undefined && val !== null) {
        stringified[key] = String(val);
      }
    }

    try {
      const auth = providerDef?.auth;
      const authProps = auth && 'props' in auth ? auth.props : undefined;
      validateVendorParams(authProps, stringified);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        'vendorParams failed provider schema validation',
      );
    }

    return stringified;
  }

  private async decryptConnectionValue(
    connectionId: string,
    encryptedValue: string,
    userId: string | undefined,
    tenantId: string,
  ): Promise<{
    clientId: string;
    hasClientSecret: boolean;
    vendorParams?: Record<string, string>;
  }> {
    try {
      const decrypted = await this.crypto.decrypt(encryptedValue);
      const { clientSecret: _clientSecret, ...creds } =
        parseConnectionCredentials(decrypted);
      this.logger.log({
        message: `Credentials accessed for connection ${connectionId}`,
        action: 'ACCESS_CREDENTIALS',
        userId,
        tenantId,
        connectionId,
        timestamp: new Date().toISOString(),
      });
      return creds;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `Failed to decrypt credentials for connection ${connectionId}: ${errMsg}`,
      );
      throw new InternalServerErrorException(
        'Failed to decrypt connection credentials',
      );
    }
  }

  /**
   * Pre-flights an OAuth session by securely storing connection credentials in Redis
   * ahead of the browser redirect.
   */
  @Post(':providerName/session')
  async createOAuthSession(
    @AuthContext() ctx: RequestAuthContext,
    @Param('providerName') providerName: string,
    @Body(new ValidationPipe({ whitelist: true })) body: CreateOAuthSession,
  ) {
    const tenantId = ctx.user?.organizationId;
    const userId = ctx.user?.id;

    if (!tenantId || !userId) {
      throw new BadRequestException('tenantId or userId context is missing');
    }

    const { clientId, vendorParams } = body;

    // validate that the path parameter matches the body payload for consistency
    if (providerName !== body.providerName) {
      throw new BadRequestException(
        'Path providerName must match body providerName',
      );
    }

    const providerDef =
      this.connectorsService.getProviderDefinition(providerName);
    if (!providerDef) {
      throw new BadRequestException(`Unknown provider: ${providerName}`);
    }

    const validatedVendorParams = this.resolveVendorParams(
      providerDef,
      vendorParams,
    );

    const sessionId = await this.oauthStateService.createPreFlightSession(
      tenantId,
      userId,
      providerName,
      clientId,
      validatedVendorParams,
    );

    return { sessionId };
  }

  /**
   * Initiates the OAuth2 flow by redirecting the user's browser to the vendor's authorization URL.
   * Consumers an opaque session ID to fetch securely vaulted parameters.
   */
  @Get(':providerName')
  async initiateOAuth(
    @AuthContext() ctx: RequestAuthContext,
    @Param('providerName') providerName: string,
    @Query('session') sessionId: string,
    @Res() res: Response,
  ) {
    const tenantId = ctx.user?.organizationId;
    const userId = ctx.user?.id;

    if (!providerName || !VALID_PROVIDER_NAME_REGEX.test(providerName)) {
      throw new BadRequestException('Invalid provider name format');
    }

    if (!tenantId || !userId) {
      throw new BadRequestException('tenantId or userId context is missing');
    }

    if (!sessionId || sessionId.trim().length === 0) {
      throw new BadRequestException('session query parameter is required');
    }

    let sessionData;
    try {
      sessionData =
        await this.oauthStateService.consumePreFlightSession(sessionId);
    } catch (error) {
      this.logger.error(
        'Failed to consume pre-flight session',
        error instanceof Error ? error.stack : String(error),
      );
      throw new UnauthorizedException(
        'Invalid or expired OAuth session. Please try connecting again.',
      );
    }

    // Safety constraint ensuring the session belongs to this specific tenant & provider & user
    if (
      sessionData.tenantId !== tenantId ||
      sessionData.provider !== providerName ||
      sessionData.userId !== userId
    ) {
      this.logger.warn(
        `Session Hijack attempt detected. Session tied to ${sessionData.tenantId}/${sessionData.provider}/${sessionData.userId} accessed by ${tenantId}/${providerName}/${userId}`,
      );
      throw new UnauthorizedException('OAuth session context mismatch');
    }

    const { clientId, vendorParams } = sessionData as {
      clientId: string;
      vendorParams?: Record<string, string>;
    };

    let authorizeUrl: string;
    try {
      const jwtState = await this.oauthStateService.generateState(
        tenantId,
        providerName,
        vendorParams,
      );
      authorizeUrl = this.connectorsService.getAuthorizationUrl(
        providerName,
        jwtState,
        clientId,
        vendorParams,
      );
    } catch (error) {
      if (
        error instanceof HttpException ||
        error instanceof AppCredentialError
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to build authorization URL for ${providerName}. INNER ERROR: ${(error as Error).stack || error}`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to initiate OAuth flow. Please try again later.',
      );
    }

    res.redirect(authorizeUrl);
  }

  @Post('oauth-exchange')
  async exchangeCode(
    @AuthContext() ctx: RequestAuthContext,
    @Body(new ValidationPipe({ whitelist: true })) body: ExchangeOAuthCode,
  ) {
    this.logger.debug(
      `oauth-exchange body received for provider: ${body.providerName}, connectionId: ${body.connectionId || 'none'}, displayName: ${body.displayName}`,
    );

    const tenantId = ctx.user?.organizationId;
    if (!tenantId) {
      throw new BadRequestException('tenantId context is missing');
    }

    const trimmedDisplayName = body.displayName.trim();
    if (trimmedDisplayName.length === 0) {
      throw new BadRequestException('displayName cannot be blank');
    }
    if (trimmedDisplayName.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new BadRequestException(
        `displayName exceeds ${MAX_DISPLAY_NAME_LENGTH} characters`,
      );
    }
    let externalId = toKebabSlug(body.providerName, trimmedDisplayName);
    if (body.connectionId) {
      try {
        const [existing] = await this.db
          .select({ externalId: appConnections.externalId })
          .from(appConnections)
          .where(
            and(
              eq(appConnections.id, body.connectionId),
              eq(appConnections.tenantId, tenantId),
              eq(appConnections.appName, body.providerName),
            ),
          );

        if (!existing) {
          throw new NotFoundException(
            `Connection ${body.connectionId} not found for provider "${body.providerName}"`,
          );
        }

        // Preserve the original unique slug to avoid falsely colliding with
        // another provider's connection that shares the same displayName.
        externalId = existing.externalId;
      } catch (err) {
        if (err instanceof NotFoundException) {
          throw err;
        }
        this.logger.error(
          `Could not find existing connection ${body.connectionId} to inherit externalId: ${(err as Error).message}`,
        );
        throw new BadRequestException(
          'Database error verifying existing connection for reconnect',
        );
      }
    }

    // Idempotency check: React StrictMode or double-clicks can cause this to fire twice rapidly.
    // Atomically claim the idempotency key to prevent TOCTOU races between duplicate requests.
    // Use the explicit connectionId if available to scope updates uniquely.
    const idempotencySuffix = body.connectionId
      ? `update:${body.connectionId}:${body.code}`
      : `create:${body.code}`;
    const idempotencyKey = `oauth:idempotency:${tenantId}:${idempotencySuffix}`;
    const acquired = await this.redis.set(
      idempotencyKey,
      'processing',
      'EX',
      60,
      'NX',
    );

    // If we didn't acquire the lock, another request is already processing this code
    if (!acquired) {
      const status = await this.redis.get(idempotencyKey);
      if (status === 'completed') {
        this.logger.debug(
          `Idempotency catch: Ignoring duplicate oauth-exchange request for ${body.providerName} (already completed)`,
        );
        return {
          success: true,
          message: 'Connection established (Idempotent)',
        };
      }
      throw new HttpException('OAuth exchange already in progress', 409);
    }

    try {
      await this.processOAuthExchange(
        tenantId,
        externalId,
        trimmedDisplayName,
        body,
        idempotencyKey,
      );

      this.logger.log(
        `[OAuth Exchange] Success: ${body.providerName} "${trimmedDisplayName}" (${externalId}) for tenant ${tenantId}`,
      );
      return { success: true, message: 'Connection established' };
    } catch (processError) {
      this.logger.error(
        'processOAuthExchange failed fundamentally:',
        processError,
      );

      // If any step of the exchange/provisioning fails, remove the idempotency
      // "processing" lock so the user can immediately try again without waiting for the EX TTL.
      try {
        await this.redis.del(idempotencyKey);
      } catch (redisError) {
        this.logger.warn(
          `Failed to release idempotency lock after connection failure for ${body.providerName}: ${(redisError as Error).message}`,
        );
      }
      throw processError; // Rethrow to let the standard NestJS exception filters handle it
    }
  }

  private async processOAuthExchange(
    tenantId: string,
    externalId: string,
    trimmedDisplayName: string,
    body: ExchangeOAuthCode,
    idempotencyKey: string,
  ) {
    // Verify piece exists in registry
    const piece = this.pieceRegistry.getPiece(body.providerName);
    if (!piece) {
      throw new NotFoundException(
        `Provider "${body.providerName}" is not registered`,
      );
    }

    const decodedState = await this.oauthStateService.verifyState(
      body.state,
      body.providerName,
    );
    if (decodedState.tenantId !== tenantId) {
      throw new BadRequestException(
        'State token does not belong to this tenant',
      );
    }

    // Validate vendorParams against piece.auth.props schema
    const authProps =
      piece.auth && 'props' in piece.auth
        ? (piece.auth.props as Record<string, AnyProperty>)
        : undefined;
    validateVendorParams(authProps, decodedState.vendorParams);

    // For reconnect flows, clientSecret may not be provided (browser never received it).
    // If connectionId is present, resolve the stored credentials server-side.
    const { effectiveClientId, effectiveClientSecret } =
      await this.resolveCredentialsForExchange(
        tenantId,
        body.clientId,
        body.clientSecret,
        body.connectionId,
      );

    // Exchange the code for actual OAuth tokens
    const tokenResponse = await this.executeTokenExchange(
      body.providerName,
      body.code,
      effectiveClientId,
      effectiveClientSecret,
      decodedState.vendorParams ?? {},
    );

    if (
      typeof tokenResponse.access_token !== 'string' ||
      !tokenResponse.access_token.trim()
    ) {
      throw new BadRequestException(
        'Invalid or missing access_token returned from vendor',
      );
    }

    const validRefreshToken = extractRefreshToken(tokenResponse);

    // Build the encrypted value blob.
    // vendorParams are persisted inside the blob so the reconnect form
    // can restore all uiSchema fields without additional database columns.
    const valueBlob: ConnectionValueBlob = {
      clientId: effectiveClientId,
      clientSecret: effectiveClientSecret,
      accessToken: tokenResponse.access_token,
      refreshToken: validRefreshToken,
      data: tokenResponse, // vendor-specific: instance_url, realmId, id_token, etc.
      vendorParams: decodedState.vendorParams ?? {},
    };

    let encryptedValue: string;
    try {
      encryptedValue = await this.crypto.encrypt(JSON.stringify(valueBlob));
    } catch (error) {
      this.logger.error(`Encryption failed for ${body.providerName}`, error);
      throw new InternalServerErrorException('Failed to encrypt credentials');
    }

    const parsedExpiresIn = parseExpiresIn(tokenResponse.expires_in);
    const MAX_EXPIRES_IN = 90 * 24 * 3600;
    const expiresIn = Math.min(parsedExpiresIn, MAX_EXPIRES_IN);

    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    const resolvedEnvType = deriveEnvType(decodedState.vendorParams);

    // Read appProfile from request (or vendor params), defaulting to 'default' when absent.
    // This allows Salesforce OAuth flows to set appProfile dynamically rather than forcing 'revenova'.
    const rawAppProfile =
      typeof body.appProfile === 'string' && body.appProfile.trim() !== ''
        ? body.appProfile.trim()
        : decodedState.vendorParams?.appProfile ?? 'default';
    const metadata: Record<string, unknown> = {
      appProfile: rawAppProfile,
    };

    await this.persistConnection(
      tenantId,
      body.providerName,
      trimmedDisplayName,
      externalId,
      encryptedValue,
      expiresAt,
      body.connectionId,
      resolvedEnvType,
      metadata,
    );

    // Mark as fully processed to prevent StrictMode duplicates from failing.
    // Wrap in try/catch so a Redis failure here doesn't turn a successful connection into a 500 error.
    try {
      await this.redis.set(idempotencyKey, 'completed', 'EX', 60);
    } catch (redisError) {
      this.logger.warn(
        `Failed to update idempotency cache for connection "${trimmedDisplayName}" (${externalId}): ${(redisError as Error).message}`,
      );
    }
  }

  /**
   * For reconnect flows where the browser does not send `clientSecret`,
   * resolve the effective credentials from the stored (encrypted) connection.
   * Falls back to the request values when no stored connection is needed or found.
   */
  private async resolveCredentialsForExchange(
    tenantId: string,
    requestClientId: string | undefined,
    requestClientSecret: string | undefined,
    connectionId: string | undefined,
  ): Promise<{ effectiveClientId: string; effectiveClientSecret: string }> {
    // If a new secret was explicitly supplied, use it as-is.
    if (requestClientSecret) {
      return {
        effectiveClientId: requestClientId ?? '',
        effectiveClientSecret: requestClientSecret,
      };
    }

    // No secret from the browser — resolve the stored credential from the connectionId.
    if (connectionId) {
      let row: { value: string } | undefined;
      try {
        const [existing] = await this.db
          .select({ value: appConnections.value })
          .from(appConnections)
          .where(
            and(
              eq(appConnections.id, connectionId),
              eq(appConnections.tenantId, tenantId),
            ),
          )
          .limit(1);
        row = existing;
      } catch (err) {
        this.logger.error(
          `resolveCredentialsForExchange: DB error for ${connectionId}: ${(err as Error).message}`,
        );
        throw new InternalServerErrorException(
          'Failed to load stored credentials for reconnect',
        );
      }

      if (!row?.value) {
        throw new NotFoundException(
          `Stored credentials not found for connection ${connectionId}`,
        );
      }

      let stored: ReturnType<typeof parseConnectionCredentials>;
      try {
        const decrypted = await this.crypto.decrypt(row.value);
        stored = parseConnectionCredentials(decrypted);
      } catch (err) {
        this.logger.error(
          `resolveCredentialsForExchange: failed to decrypt/parse for ${connectionId}: ${(err as Error).message}`,
        );
        throw new InternalServerErrorException(
          'Failed to decrypt stored credentials for reconnect',
        );
      }

      if (!stored.clientSecret) {
        throw new BadRequestException(
          `No stored client secret found for connection ${connectionId}. Please provide a new client secret.`,
        );
      }

      return {
        effectiveClientId: requestClientId || stored.clientId,
        effectiveClientSecret: stored.clientSecret,
      };
    }

    // No connectionId and no secret — pass through whatever was provided (may fail at token exchange).
    return {
      effectiveClientId: requestClientId ?? '',
      effectiveClientSecret: requestClientSecret ?? '',
    };
  }

  private async executeTokenExchange(
    providerName: string,
    code: string,
    clientId: string,
    clientSecret: string,
    vendorParams: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.connectorsService.exchangeCodeForTokens(
        providerName,
        code,
        clientId,
        clientSecret,
        vendorParams,
      );
    } catch (error) {
      if (
        error instanceof HttpException ||
        error instanceof AppCredentialError
      ) {
        throw error;
      }
      this.logger.error(`Token exchange failed for ${providerName}`, error);
      throw new InternalServerErrorException('Failed to exchange auth code');
    }
  }

  private async persistConnection(
    tenantId: string,
    providerName: string,
    displayName: string,
    externalId: string,
    encryptedValue: string,
    expiresAt: Date,
    connectionId?: string,
    envType?: 'PRODUCTION' | 'SANDBOX',
    metadata?: Record<string, unknown>,
  ) {
    try {
      await this.connectorsService.storeOAuthConnection({
        id: connectionId,
        tenantId,
        providerName,
        externalId,
        displayName,
        authType: 'OAUTH2',
        value: encryptedValue,
        expiresAt,
        metadata: metadata ?? {},
        envType,
      });
    } catch (error) {
      if (
        error instanceof HttpException ||
        error instanceof AppCredentialError
      ) {
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

  @Delete(':connectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConnection(
    @AuthContext() ctx: RequestAuthContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    const tenantId = ctx.user?.organizationId;
    if (!tenantId || !ctx.user?.id) {
      throw new BadRequestException('tenantId or user context is missing');
    }

    await this.assertAdminOrOwner(ctx.user.id, tenantId);

    // Validates RESTRICT constraints on global_entity_map before deleting
    await this.connectorsService.deleteConnection(tenantId, connectionId);
  }

  /**
   * Asserts that the given user is an admin or owner of the given tenant.
   * Throws ForbiddenException if the check fails.
   */
  private async assertAdminOrOwner(
    userId: string,
    tenantId: string,
  ): Promise<void> {
    const [orgMember] = await this.db
      .select({ role: member.role })
      .from(member)
      .where(
        and(eq(member.userId, userId), eq(member.organizationId, tenantId)),
      )
      .limit(1);

    if (
      !orgMember ||
      (orgMember.role !== getAdminRoleId() &&
        orgMember.role !== getOwnerRoleId())
    ) {
      throw new ForbiddenException(
        'Only organization admins or owners can perform this action',
      );
    }
  }
}
