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

export const VALID_PROVIDER_NAME_REGEX = /^[A-Za-z0-9_-]+$/;
import { AuthContext, type RequestAuthContext, AuthGuard } from '@nexiom/auth';
import { EncryptionService, AppCredentialError } from '@nexiom/connectors';
import { z } from 'zod';
import type { AnyProperty } from '@nexiom/connectors';
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
import type { ConnectionValueBlob } from '../connectors.service.js';

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
  if (String(prop.type) === 'STATIC_DROPDOWN') {
    const p = prop as Record<string, unknown>;
    if (
      typeof p.options === 'object' &&
      p.options !== null &&
      'options' in p.options &&
      Array.isArray((p.options as Record<string, unknown>).options)
    ) {
      const opts = (p.options as Record<string, unknown>).options as Array<
        Record<string, unknown>
      >;
      const allowed = new Set(opts.map((o) => String(o.value)));
      if (!allowed.has(String(val))) {
        throw new BadRequestException(`Parameter ${key} has an invalid value`);
      }
    } else {
      throw new BadRequestException(`Parameter ${key} has malformed options`);
    }
  }
}

function parseConnectionCredentials(decrypted: string): {
  clientId: string;
  hasClientSecret: boolean;
  vendorParams?: Record<string, string>;
} {
  const parsed = JSON.parse(decrypted) as ConnectionValueBlob;

  const clientId = typeof parsed.clientId === 'string' ? parsed.clientId : '';
  const hasClientSecret =
    typeof parsed.clientSecret === 'string' && parsed.clientSecret.length > 0;

  let rawVendorParams: Record<string, string> | undefined;
  if (parsed.vendorParams && Object.keys(parsed.vendorParams).length > 0) {
    rawVendorParams = parsed.vendorParams;
  }

  let vendorParams: Record<string, string> | undefined;
  if (parsed.environment) {
    vendorParams = rawVendorParams || {};
    if (!vendorParams.environment) {
      vendorParams.environment = String(parsed.environment);
    }
  } else {
    vendorParams = rawVendorParams;
  }

  return { clientId, hasClientSecret, vendorParams };
}

function parseVendorParamsJson(
  vendorParamsJson: string | undefined,
): Record<string, string> {
  if (!vendorParamsJson) return {};

  try {
    const parsed: unknown = JSON.parse(vendorParamsJson);
    const parseResult = z
      .record(z.string(), z.string())
      .refine((obj) => Object.keys(obj).length <= 15, {
        message: 'vendorParams cannot exceed 15 keys',
      })
      .safeParse(parsed);

    if (!parseResult.success) {
      throw new BadRequestException(
        `Invalid vendorParams format: ${parseResult.error.issues[0]?.message}`,
      );
    }
    return parseResult.data;
  } catch (err) {
    if (err instanceof BadRequestException) {
      throw err;
    }
    throw new BadRequestException('Invalid vendorParams JSON format');
  }
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

  // Reject keys not declared in the schema.
  const declaredKeys = new Set(Object.keys(schema));
  for (const key of Object.keys(params)) {
    if (!declaredKeys.has(key)) {
      throw new BadRequestException(
        `Undeclared vendor parameter: "${key}" is not allowed`,
      );
    }
  }

  // Validate each declared field.
  for (const [key, prop] of Object.entries(schema)) {
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
  const safeProviderName = providerName as string;
  const safeDisplayName = displayName;
  if (!VALID_PROVIDER_NAME_REGEX.test(safeProviderName)) {
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
    if (!tenantId) {
      throw new BadRequestException('tenantId context is missing');
    }

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

    let clientId = '';
    let hasClientSecret = false;
    let vendorParams: Record<string, string> | undefined;

    if (connection.value) {
      try {
        const decrypted = await this.crypto.decrypt(connection.value);
        const creds = parseConnectionCredentials(decrypted);

        clientId = creds.clientId;
        hasClientSecret = creds.hasClientSecret;
        vendorParams = creds.vendorParams;

        this.logger.log({
          message: `Credentials accessed for connection ${connection.id}`,
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

    return { clientId, hasClientSecret, vendorParams };
  }

  /**
   * Initiates the OAuth2 flow by redirecting the user's browser to the
   * vendor's authorization URL.
   *
   * vendorParams (passed as query params) are embedded in the signed JWT state
   * so they can be retrieved on the callback to resolve URL templates.
   */
  @Get(':providerName')
  async initiateOAuth(
    @AuthContext() ctx: RequestAuthContext,
    @Param('providerName') providerName: string,
    @Query('clientId') clientId: string,
    @Query('vendorParams') vendorParamsJson: string | undefined,
    @Res() res: Response,
  ) {
    const tenantId = ctx.user?.organizationId;

    if (!providerName || !VALID_PROVIDER_NAME_REGEX.test(providerName)) {
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

    // vendorParams are JSON-serialised by the frontend and sent as a single queryParam
    const vendorParams = parseVendorParamsJson(vendorParamsJson);

    // Validate vendorParams against the provider schema so only approved fields
    // are signed into the OAuth state and forwarded to the authorize URL.
    let validatedVendorParams: Record<string, string> = {};
    try {
      const providerDef =
        this.connectorsService.getProviderDefinition(providerName);
      // auth.props only exists on OAuth2Auth and CustomAuth, not SecretTextAuth
      const auth = providerDef?.auth;
      const authProps = auth && 'props' in auth ? auth.props : undefined;
      validateVendorParams(authProps, vendorParams);
      validatedVendorParams = vendorParams;
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new BadRequestException(
        'vendorParams failed provider schema validation',
      );
    }

    let authorizeUrl: string;
    try {
      const jwtState = await this.oauthStateService.generateState(
        tenantId,
        providerName,
        validatedVendorParams,
      );
      authorizeUrl = this.connectorsService.getAuthorizationUrl(
        providerName,
        jwtState,
        clientId,
        validatedVendorParams,
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
    },
  ) {
    const tenantId = ctx.user?.organizationId;
    if (!tenantId) {
      throw new BadRequestException('tenantId context is missing');
    }

    const { trimmedDisplayName, externalId } = validateExchangeBody(
      body.providerName,
      body.code,
      body.clientId,
      body.clientSecret,
      body.state,
      body.displayName,
    );

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

    // Exchange the code for actual OAuth tokens
    let tokenResponse: Record<string, unknown>;
    try {
      tokenResponse = await this.connectorsService.exchangeCodeForTokens(
        body.providerName,
        body.code,
        body.clientId,
        body.clientSecret,
        decodedState.vendorParams ?? {},
      );
    } catch (error) {
      if (
        error instanceof HttpException ||
        error instanceof AppCredentialError
      ) {
        throw error;
      }
      this.logger.error(
        `Token exchange failed for ${body.providerName}`,
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

    // Build the encrypted value blob.
    // vendorParams are persisted inside the blob so the reconnect form
    // can restore all uiSchema fields without additional database columns.
    const valueBlob: ConnectionValueBlob = {
      clientId: body.clientId,
      clientSecret: body.clientSecret,
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

    try {
      await this.connectorsService.storeOAuthConnection({
        tenantId,
        providerName: body.providerName,
        externalId,
        displayName: trimmedDisplayName,
        authType: 'OAUTH2',
        value: encryptedValue,
        expiresAt,
        metadata: {},
      });
    } catch (error) {
      if (
        error instanceof HttpException ||
        error instanceof AppCredentialError
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to store connection "${trimmedDisplayName}" (${externalId}) for ${body.providerName}`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to save connection to database',
      );
    }

    this.logger.log(
      `[OAuth Exchange] Success: ${body.providerName} "${trimmedDisplayName}" (${externalId}) for tenant ${tenantId}`,
    );
    return { success: true };
  }
}
