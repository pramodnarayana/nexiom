import {
  Controller,
  Get,
  Delete,
  HttpCode,
  HttpStatus,
  UseGuards,
  Inject,
  InternalServerErrorException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Query,
  Logger,
  HttpException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthContext, type RequestAuthContext, AuthGuard } from '@soopa/auth';
import { getAdminRoleId, getOwnerRoleId } from '@soopa/identity/constants';
import { EncryptionService } from '@soopa/credentials';
import { PieceRegistryService } from '@soopa/piece-registry';
import {
  dataSources,
  credentials,
  AppConnectionStatus,
  DATABASE_CONNECTION,
  type DrizzleDb,
  member,
} from '@soopa/database';
import { eq, and, count, desc } from 'drizzle-orm';
import type { AnyProperty } from '@soopa/piece-framework';
import { CredentialLinkingService } from '../services/credential-linking.service.js';
import type { ConnectionValueBlob } from '../connectors.service.js';

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
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly credentialLinking: CredentialLinkingService,
    private readonly crypto: EncryptionService,
  ) {}

  @Get('providers')
  getProviders() {
    try {
      const providers = this.pieceRegistry
        .getAllPieces()
        .map((piece) => {
          const authProps =
            piece.auth && 'props' in piece.auth
              ? (piece.auth.props as Record<string, AnyProperty>)
              : undefined;

          const baseProvider = {
            name: piece.name,
            displayName: piece.displayName,
            description: piece.description,
            logoUrl: piece.logoUrl,
            authType: piece.auth.type,
            category: piece.categories?.[0] ?? 'Other',
            uiSchema: authProps,
          };

          const result = [baseProvider];

          if (piece.aliases) {
            for (const alias of piece.aliases) {
              result.push({
                name: alias.name,
                displayName: alias.displayName,
                description: alias.description || piece.description,
                logoUrl: alias.logoUrl || piece.logoUrl,
                authType: piece.auth.type,
                category: alias.category || baseProvider.category,
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

    const whereClause = and(
      eq(dataSources.tenantId, tenantId),
      eq(credentials.status, AppConnectionStatus.ACTIVE),
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
            id: dataSources.id,
            appName: dataSources.appName,
            externalId: dataSources.externalId,
            displayName: dataSources.displayName,
            authType: credentials.authType,
            status: credentials.status,
            envType: dataSources.envType,
            metadata: dataSources.metadata,
            expiresAt: credentials.expiresAt,
            createdAt: dataSources.createdAt,
            updatedAt: dataSources.updatedAt,
            value: credentials.value,
          })
          .from(dataSources)
          .innerJoin(credentials, eq(credentials.dataSourceId, dataSources.id))
          .where(whereClause)
          .orderBy(desc(dataSources.createdAt), desc(dataSources.id))
          .limit(limit)
          .offset(offset),

        this.db
          .select({ count: count() })
          .from(dataSources)
          .innerJoin(credentials, eq(credentials.dataSourceId, dataSources.id))
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
    this.logger.log(
      `[getActiveConnections] tenantId=${tenantId}, total=${total}, returning ${activeConnections.length} rows`,
    );

    const listConnections = activeConnections.map((conn) => {
      const hasCredentials = !!conn.value;

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

    const [connection] = await this.db
      .select({
        id: dataSources.id,
        value: credentials.value,
      })
      .from(dataSources)
      .innerJoin(credentials, eq(credentials.dataSourceId, dataSources.id))
      .where(
        and(
          eq(dataSources.id, dataSourceId),
          eq(dataSources.tenantId, tenantId),
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
      await this.credentialLinking.deleteConnection(tenantId, dataSourceId);
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
