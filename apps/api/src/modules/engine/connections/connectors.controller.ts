import {
  Controller,
  Get,
  Req,
  UseGuards,
  Inject,
  UnauthorizedException,
  Query,
} from '@nestjs/common';
import { Request } from 'express';
import { ProviderRegistryService, DrizzleDb } from '@nexiom/engine';
import { appConnections, AppConnectionStatus } from '@nexiom/database';
import { eq, and } from 'drizzle-orm';
import { AuthGuard } from '../../identity/auth/auth.guard';

@Controller('connectors')
@UseGuards(AuthGuard)
export class ConnectorsController {
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
    if (Number.isNaN(limit) || !Number.isFinite(limit)) {
      limit = 50;
    }
    limit = Math.max(0, Math.min(limit, 100));

    let offset = Number.parseInt(offsetStr || '0', 10);
    if (Number.isNaN(offset) || !Number.isFinite(offset) || offset < 0) {
      offset = 0;
    }

    const activeConnections = await this.db
      .select({
        id: appConnections.id,
        appName: appConnections.appName,
        status: appConnections.status,
        metadata: appConnections.metadata,
        createdAt: appConnections.createdAt,
        updatedAt: appConnections.updatedAt,
      })
      .from(appConnections)
      .where(
        and(
          eq(appConnections.tenantId, tenantId),
          eq(appConnections.status, AppConnectionStatus.ACTIVE),
        ),
      )
      .limit(limit)
      .offset(offset);

    return {
      data: activeConnections,
      metadata: { limit, offset, count: activeConnections.length },
    };
  }
}
