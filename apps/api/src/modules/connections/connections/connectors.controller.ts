import {
  Controller,
  Get,
  Req,
  UseGuards,
  Inject,
  UnauthorizedException,
  InternalServerErrorException,
  Query,
  Logger,
  Param,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ProviderRegistryService, DrizzleDb } from '@nexiom/connections';
import { ConnectorsService } from '../connectors.service';
import { OauthStateService } from '../oauth-state.service';
import { appConnections, AppConnectionStatus } from '@nexiom/database';
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
  ) {}

  @Get(':provider')
  async connect(
    @Param('provider') providerName: string,
    @Req() req: Request & { user?: { tenantId: string } },
    @Res() res: Response,
  ) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new UnauthorizedException('Tenant ID missing from request');
    }

    try {
      const state = this.oauthStateService.generateState(
        tenantId,
        providerName,
      );
      const url = await this.connectorsService.getAuthorizationUrl(
        providerName,
        state,
      );

      // Redirect the user browser to the vendor's OAuth page
      return res.redirect(url);
    } catch (error) {
      this.logger.error(
        `Failed to initiate OAuth connect for ${providerName}`,
        error,
      );
      throw new InternalServerErrorException(
        `Failed to initiate OAuth connect for ${providerName}`,
      );
    }
  }

  @Get('providers')
  async getProviders() {
    try {
      const providers = await this.providerRegistry.getAllProviders();
      // Only return the necessary public info to the frontend
      return providers.map((p) => ({
        name: p.name,
        displayName: p.displayName,
        description: p.description,
        logoUrl: p.logoUrl,
        authType: p.authType,
        category: p.category,
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
    @Req() req: Request & { user?: { tenantId: string } },
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new UnauthorizedException('Tenant ID missing from request');
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
}
