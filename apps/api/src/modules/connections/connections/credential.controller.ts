import {
  Controller,
  Get,
  Delete,
  HttpCode,
  HttpStatus,
  UseGuards,
  InternalServerErrorException,
  BadRequestException,
  NotFoundException,
  Query,
  Logger,
  HttpException,
  Param,
  Inject,
  ParseUUIDPipe,
  Patch,
  Body,
} from '@nestjs/common';
import { AuthContext, type RequestAuthContext, AuthGuard } from '@soopa/auth';
import { ENCRYPTION_SERVICE, type IEncryptionService } from '@soopa/security';
import { PieceRegistryService } from '@soopa/piece-registry';
import { ConnectionRepository } from '../repositories/connection.repository.js';
import { DeleteConnectionUseCase } from '../core/use-cases/delete-connection.use-case.js';
import type { ConnectionValueBlob } from '../core/types/connection.types.js';
import { ConfigService } from '@nestjs/config';

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

@Controller('connectors')
@UseGuards(AuthGuard)
export class CredentialController {
  private readonly logger = new Logger(CredentialController.name);

  constructor(
    private readonly connectionRepository: ConnectionRepository,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly deleteConnectionUseCase: DeleteConnectionUseCase,
    private readonly configService: ConfigService,
    @Inject(ENCRYPTION_SERVICE) private readonly crypto: IEncryptionService,
  ) {}

  @Get('providers')
  async getProviders() {
    try {
      const dbPieces = await this.connectionRepository.getEnabledPieces();
      const providers = dbPieces
        .map((piece) => {
          const registeredPiece = this.pieceRegistry.getPiece(piece.name);
          if (!registeredPiece) {
            return [];
          }

          const authProps = piece.authSchema as
            | Record<string, unknown>
            | undefined;
          const categories = piece.categories as string[] | undefined;
          const aliases = piece.aliases as
            | Record<string, unknown>[]
            | undefined;

          const baseProvider = {
            name: piece.name,
            displayName: piece.displayName,
            description: piece.description,
            logoUrl: piece.logoUrl,
            authType: piece.authType,
            category: categories?.[0] ?? 'Other',
            uiSchema: authProps,
          };

          const result = [baseProvider];

          if (aliases && Array.isArray(aliases)) {
            for (const alias of aliases) {
              result.push({
                name: String(alias.name),
                displayName: String(alias.displayName),
                description:
                  typeof alias.description === 'string'
                    ? alias.description
                    : piece.description,
                logoUrl:
                  typeof alias.logoUrl === 'string'
                    ? alias.logoUrl
                    : piece.logoUrl,
                authType: piece.authType,
                category:
                  typeof alias.category === 'string'
                    ? alias.category
                    : baseProvider.category,
                uiSchema: authProps,
              });
            }
          }

          return result;
        })
        .flat();

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

    let activeConnections: Awaited<
      ReturnType<ConnectionRepository['findActiveWithCredentialsByTenant']>
    >['activeConnections'] = [];
    let countResult: { count: number } | undefined;
    try {
      const result =
        await this.connectionRepository.findActiveWithCredentialsByTenant(
          tenantId,
          limit,
          offset,
        );
      activeConnections = result.activeConnections;
      countResult = { count: result.total };
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
    this.logger.log(
      `[getActiveConnections] tenantId=${tenantId}, total=${total}, returning ${activeConnections.length} rows`,
    );

    const rawApiUrl =
      this.configService.get<string>('API_URL') ||
      process.env.API_URL ||
      'http://localhost:3000';
    const apiUrl = rawApiUrl.replace(/\/+$/, '');

    const listConnections = activeConnections.map((conn) => {
      const hasCredentials = conn.hasCredentials;

      let aliasAppName = conn.appName;
      const piece = this.pieceRegistry.getPiece(conn.appName);
      if (
        piece?.aliases &&
        conn.metadata &&
        typeof conn.metadata === 'object' &&
        'appProfile' in conn.metadata
      ) {
        const appProfile = (conn.metadata as Record<string, unknown>)
          .appProfile;
        if (typeof appProfile === 'string') {
          const alias = piece.aliases.find((a) => a.appProfile === appProfile);
          if (alias) {
            aliasAppName = alias.name;
          }
        }
      }

      return {
        id: conn.id,
        appName: aliasAppName,
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
        vendorTenantId: conn.vendorTenantId,
        webhookUrl: `${apiUrl}/v1/webhooks/${conn.id}`,
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
    @Param('id', ParseUUIDPipe) dataSourceId: string,
  ) {
    const tenantId = ctx.user?.organizationId;
    if (!tenantId || !ctx.user?.id) {
      throw new BadRequestException('tenantId or user context is missing');
    }

    await this.assertAdminOrOwner(ctx.user.id, tenantId);

    const connection = await this.connectionRepository.getConnectionCredentials(
      dataSourceId,
      tenantId,
    );

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

  private async decryptConnectionValue(
    dataSourceId: string,
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
        message: `Credentials accessed for connection ${dataSourceId}`,
        action: 'ACCESS_CREDENTIALS',
        userId,
        tenantId,
        dataSourceId,
        timestamp: new Date().toISOString(),
      });
      return creds;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `Failed to decrypt credentials for connection ${dataSourceId}: ${errMsg}`,
      );
      throw new InternalServerErrorException(
        'Failed to decrypt connection credentials',
      );
    }
  }

  @Delete(':dataSourceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConnection(
    @AuthContext() ctx: RequestAuthContext,
    @Param('dataSourceId', ParseUUIDPipe) dataSourceId: string,
  ) {
    const tenantId = ctx.user?.organizationId;
    if (!tenantId || !ctx.user?.id) {
      throw new BadRequestException('tenantId or user context is missing');
    }

    try {
      await this.assertAdminOrOwner(ctx.user.id, tenantId);
      await this.deleteConnectionUseCase.execute(tenantId, dataSourceId);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Failed to delete connection ${dataSourceId} for tenant ${tenantId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'An unexpected error occurred while deleting the connection',
      );
    }
  }

  @Patch(':dataSourceId')
  @HttpCode(HttpStatus.OK)
  async updateConnection(
    @AuthContext() ctx: RequestAuthContext,
    @Param('dataSourceId', ParseUUIDPipe) dataSourceId: string,
    @Body() body: { displayName: string },
  ) {
    const tenantId = ctx.user?.organizationId;
    if (!tenantId || !ctx.user?.id) {
      throw new BadRequestException('tenantId or user context is missing');
    }

    if (typeof body.displayName !== 'string') {
      throw new BadRequestException('displayName must be a string');
    }
    const trimmedDisplayName = body.displayName.trim();
    if (!trimmedDisplayName || trimmedDisplayName.length === 0) {
      throw new BadRequestException('displayName cannot be blank');
    }
    if (trimmedDisplayName.length > 100) {
      throw new BadRequestException('displayName exceeds 100 characters');
    }

    try {
      await this.assertAdminOrOwner(ctx.user.id, tenantId);

      const connection = await this.connectionRepository.findByIdAndTenant(
        dataSourceId,
        tenantId,
      );
      if (!connection) {
        throw new NotFoundException('Connection not found');
      }

      await this.connectionRepository.updateDisplayName(
        dataSourceId,
        tenantId,
        trimmedDisplayName,
      );

      return { success: true, message: 'Connection updated successfully' };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Failed to update connection ${dataSourceId} for tenant ${tenantId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'An unexpected error occurred while updating the connection',
      );
    }
  }

  private async assertAdminOrOwner(
    userId: string,
    tenantId: string,
  ): Promise<void> {
    await this.connectionRepository.assertAdminOrOwner(userId, tenantId);
  }
}
