import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Param,
  Query,
  Res,
  Logger,
  BadRequestException,
  UnauthorizedException,
  InternalServerErrorException,
  ValidationPipe,
  HttpException,
} from '@nestjs/common';

import type { Response } from 'express';
import { AuthContext, type RequestAuthContext, AuthGuard } from '@soopa/auth';
import { PieceRegistryService } from '@soopa/piece-registry';
import { AppCredentialError } from '@soopa/credentials';
import { ConnectionRepository } from '../repositories/connection.repository.js';

import { OauthStateService } from '../oauth-state.service.js';
import { StoreOAuthConnectionUseCase } from '../core/use-cases/store-oauth-connection.use-case.js';
import { GetAuthorizationUrlUseCase } from '../core/use-cases/get-authorization-url.use-case.js';
import { ExchangeOAuthTokenUseCase } from '../core/use-cases/exchange-oauth-token.use-case.js';
import { GetExistingOAuthCredentialsUseCase } from '../core/use-cases/get-existing-oauth-credentials.use-case.js';
import { CreateOAuthSession } from '../validation/create-oauth-session.js';
import { ExchangeOAuthCode } from '../validation/exchange-oauth-code.js';
import { VALID_PROVIDER_NAME_REGEX } from '../validation/constants.js';
import { randomBytes } from 'crypto';
import type { AnyProperty } from '@soopa/piece-framework';

/** Converts a human-readable display name to an enterprise-safe URL slug used as externalId */
function toKebabSlug(providerName: string, displayName: string): string {
  const baseSlug = displayName
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/(^-+)|(-+$)/g, '');

  const uniqueSuffix = randomBytes(6).toString('hex'); // 12 characters for better collision resistance
  return `${providerName}-${baseSlug}-${uniqueSuffix}`;
}

const MAX_DISPLAY_NAME_LENGTH = 100;

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

function validateVendorParams(
  schema: Record<string, AnyProperty> | undefined,
  vendorParams: Record<string, string> | undefined,
): void {
  const params = vendorParams ?? {};

  if (!schema) {
    return;
  }

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

  for (const [key, val] of Object.entries(params)) {
    if (!declaredKeys.has(key)) {
      continue;
    }
    assertPropValue(key, val, schema[key]);
  }
}

function deriveEnvType(
  vendorParams: Record<string, string | number | boolean> | undefined,
): 'PRODUCTION' | 'SANDBOX' {
  return vendorParams?.environment === 'test' ? 'SANDBOX' : 'PRODUCTION';
}

function parseExpiresIn(expiresIn: unknown): number {
  const DEFAULT = 3600;
  if (typeof expiresIn === 'number' && expiresIn > 0) return expiresIn;
  if (typeof expiresIn === 'string') {
    const parsed = Number.parseInt(expiresIn, 10);
    if (parsed > 0) return parsed;
  }
  return DEFAULT;
}

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

@Controller('connectors')
@UseGuards(AuthGuard)
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(
    private readonly connectionRepository: ConnectionRepository,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly oauthStateService: OauthStateService,
    private readonly getAuthorizationUrlUseCase: GetAuthorizationUrlUseCase,
    private readonly exchangeOAuthTokenUseCase: ExchangeOAuthTokenUseCase,
    private readonly storeOAuthConnectionUseCase: StoreOAuthConnectionUseCase,
    private readonly getExistingOAuthCredentialsUseCase: GetExistingOAuthCredentialsUseCase,
  ) {}

  private resolveVendorParams(
    providerDef: ReturnType<PieceRegistryService['getPiece']>,
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

    const { vendorParams } = body;

    const originalParamName = providerName;
    const originalBodyName = body.providerName;

    providerName = this.pieceRegistry.resolveBasePieceName(providerName);
    body.providerName = this.pieceRegistry.resolveBasePieceName(
      body.providerName,
    );

    if (providerName !== body.providerName) {
      throw new BadRequestException(
        'Path providerName must match body providerName',
      );
    }

    const aliasName =
      originalParamName !== providerName
        ? originalParamName
        : originalBodyName !== providerName
          ? originalBodyName
          : undefined;
    let aliasInjectedProfile: string | undefined;
    if (aliasName) {
      const basePiece = this.pieceRegistry.getPiece(providerName);
      const aliasDef = basePiece?.aliases?.find((a) => a.name === aliasName);
      if (aliasDef?.appProfile) {
        aliasInjectedProfile = aliasDef.appProfile;
        this.logger.log(
          `[createOAuthSession] Alias "${aliasName}" detected → injecting appProfile="${aliasInjectedProfile}" into vendorParams`,
        );
      }
    }

    const providerDef = this.pieceRegistry.getPiece(providerName);
    if (!providerDef) {
      throw new BadRequestException(`Unknown provider: ${providerName}`);
    }

    const validatedVendorParams = this.resolveVendorParams(
      providerDef,
      vendorParams,
    );

    const metadata: Record<string, unknown> = {};
    if (aliasInjectedProfile) {
      metadata.appProfile = aliasInjectedProfile;
    }

    const sessionId = await this.oauthStateService.createPreFlightSession(
      tenantId,
      userId,
      providerName,
      body.clientId?.trim(),
      validatedVendorParams,
      metadata,
    );

    return { sessionId };
  }

  @Get(':providerName')
  async initiateOAuth(
    @AuthContext() ctx: RequestAuthContext,
    @Param('providerName') providerName: string,
    @Query('session') sessionId: string,
    @Res() res: Response,
  ) {
    providerName = this.pieceRegistry.resolveBasePieceName(providerName);

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

    const { clientId, vendorParams, metadata } = sessionData as {
      clientId: string;
      vendorParams?: Record<string, string>;
      metadata?: Record<string, unknown>;
    };

    let authorizeUrl: string;
    try {
      const jwtState = await this.oauthStateService.generateState(
        tenantId,
        providerName,
        vendorParams,
        metadata,
      );
      authorizeUrl = this.getAuthorizationUrlUseCase.execute(
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
    const originalProviderName = body.providerName;
    body.providerName = this.pieceRegistry.resolveBasePieceName(
      body.providerName,
    );

    let aliasAppProfile: string | undefined;
    if (originalProviderName !== body.providerName) {
      const basePiece = this.pieceRegistry.getPiece(body.providerName);
      const aliasDef = basePiece?.aliases?.find(
        (a) => a.name === originalProviderName,
      );
      if (aliasDef) {
        aliasAppProfile = aliasDef.appProfile;
      }
    }

    this.logger.log(
      `[OAuth Exchange] RECEIVED: providerName=${originalProviderName} → resolved=${body.providerName}, alias appProfile=${aliasAppProfile ?? 'none'}, displayName="${body.displayName}", dataSourceId=${body.dataSourceId || 'new'}`,
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
    let preservedOrganizationId: string | undefined = undefined;
    let existingClientId: string | undefined = undefined;
    let existingClientSecret: string | undefined = undefined;
    if (body.dataSourceId) {
      try {
        const existing = await this.connectionRepository.findByIdAndTenant(
          body.dataSourceId,
          tenantId,
        );

        if (!existing || existing.appName !== body.providerName) {
          throw new BadRequestException(
            `Connection ${body.dataSourceId} not found or does not belong to your organization`,
          );
        }

        externalId = existing.externalId;
        if (existing.organizationId) {
          preservedOrganizationId = existing.organizationId;
        }

        const { clientId, clientSecret } =
          await this.getExistingOAuthCredentialsUseCase.execute(
            body.dataSourceId,
            tenantId,
          );
        existingClientId = clientId;
        existingClientSecret = clientSecret;
        this.logger.log(
          `[OAuth Exchange] Overriding externalId with existing: ${externalId}`,
        );
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        this.logger.error(
          `Failed to lookup existing externalId for ${body.dataSourceId}`,
          err,
        );
        throw new InternalServerErrorException(
          'Failed to verify existing connection',
        );
      }
    }

    let statePayload;
    try {
      statePayload = await this.oauthStateService.verifyState(
        body.state,
        body.providerName,
      );
      if (statePayload.tenantId !== tenantId) {
        throw new UnauthorizedException('OAuth session context mismatch');
      }
    } catch (error) {
      this.logger.error(
        'Failed to verify OAuth state payload',
        error instanceof Error ? error.stack : String(error),
      );
      throw new UnauthorizedException(
        'Invalid or expired OAuth state. Please start the connection process again.',
      );
    }

    const { vendorParams: stateVendorParams, metadata } = statePayload;

    const providerDef = this.pieceRegistry.getPiece(body.providerName);
    const mergedVendorParams = {
      ...(body.vendorParams || {}),
      ...(stateVendorParams || {}),
    };
    const vendorParams = this.resolveVendorParams(
      providerDef,
      mergedVendorParams,
    );

    let tokens: Record<string, unknown>;
    let finalClientId: string | undefined;
    let finalClientSecret: string | undefined;
    try {
      finalClientId = (body.clientId || existingClientId)?.trim();
      finalClientSecret = (body.clientSecret || existingClientSecret)?.trim();

      if (!finalClientId || !finalClientSecret) {
        throw new BadRequestException(
          `Cannot reconnect: Client ID or Client Secret is missing. The existing credentials could not be decrypted. Please recreate the connection.`,
        );
      }

      const stringifiedVendorParams = Object.fromEntries(
        Object.entries(vendorParams).map(([k, v]) => [k, String(v)]),
      );

      tokens = await this.exchangeOAuthTokenUseCase.execute(
        body.providerName,
        body.code,
        finalClientId,
        finalClientSecret,
        stringifiedVendorParams,
      );
    } catch (err: unknown) {
      let status = 500;
      let message = 'Unexpected error during token exchange';

      if (err instanceof Error) {
        message = err.message;
        if (
          'status' in err &&
          typeof (err as { status?: unknown }).status === 'number'
        ) {
          status = (err as { status: number }).status;
        }
      }

      this.logger.error(
        `Failed to exchange code with ${body.providerName}. Status: ${status}. Message: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );

      if (status === 400)
        throw new BadRequestException(
          `Failed to exchange code with ${body.providerName}`,
        );
      if (status === 401)
        throw new UnauthorizedException(
          `Failed to exchange code with ${body.providerName}`,
        );
      if (status >= 400 && status < 500)
        throw new HttpException(
          `Failed to exchange code with ${body.providerName}`,
          status,
        );
      throw new InternalServerErrorException(message);
    }

    const expiresInSeconds = parseExpiresIn(tokens.expires_in);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const valueBlob: Record<string, unknown> = {
      clientId: finalClientId,
      clientSecret: finalClientSecret,
      accessToken: tokens.access_token as string,
      data: tokens,
      vendorParams,
    };

    const refreshToken = extractRefreshToken(tokens);
    if (refreshToken) {
      valueBlob.refreshToken = refreshToken;
    }

    // Keep verified metadata as authoritative, only add appProfile if not already set
    const mergedMetadata = {
      ...metadata,
      ...(aliasAppProfile && !metadata?.appProfile
        ? { appProfile: aliasAppProfile }
        : {}),
      originalProviderName,
    };

    const envType = deriveEnvType(vendorParams);

    // Extract organizationId from frontend callback param OR from token payload via Piece Framework
    const pieceDef = this.pieceRegistry.getPiece(body.providerName);
    const authDef = pieceDef?.auth;
    let extractedOrganizationId: string | undefined;
    if (
      authDef &&
      'extractOrganizationId' in authDef &&
      typeof authDef.extractOrganizationId === 'function'
    ) {
      try {
        extractedOrganizationId = authDef.extractOrganizationId({
          ...vendorParams,
          ...tokens,
        });
      } catch (e) {
        this.logger.warn(
          `Failed to extract organizationId for ${body.providerName}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // Prefer provider-extracted organizationId; validate if both present
    if (
      extractedOrganizationId &&
      body.organizationId &&
      extractedOrganizationId !== body.organizationId
    ) {
      throw new BadRequestException(
        `organizationId mismatch: extracted="${extractedOrganizationId}" vs supplied="${body.organizationId}"`,
      );
    }
    const finalOrganizationId =
      extractedOrganizationId ??
      body.organizationId ??
      preservedOrganizationId ??
      undefined;

    if (!finalOrganizationId) {
      throw new BadRequestException(
        `organizationId is required for this provider. The connection cannot be created without a unique organization identifier.`,
      );
    }

    const stringifiedValue = JSON.stringify(valueBlob);
    await this.storeOAuthConnectionUseCase.execute({
      id: body.dataSourceId,
      tenantId,
      providerName: body.providerName,
      externalId,
      displayName: trimmedDisplayName,
      authType: 'OAUTH2',
      value: stringifiedValue,
      expiresAt,
      metadata: mergedMetadata,
      envType,
      organizationId: finalOrganizationId,
    });

    return {
      success: true,
      message: `${trimmedDisplayName} connected successfully.`,
    };
  }
}
