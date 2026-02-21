import {
  Controller,
  Get,
  Req,
  UseGuards,
  Inject,
  UnauthorizedException,
  Query,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { ProviderRegistryService, DrizzleDb } from '@nexiom/engine';
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
  ) {}

  @Get('providers')
  async getProviders() {
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
      this.logger.error('Failed to get active connections', error, {
        tenantId,
        limit,
        offset,
      });
      throw error;
    }

    const total = Number(countResult?.count ?? 0);

    return {
      data: activeConnections,
      metadata: { limit, offset, count: total },
    };
  }
}
