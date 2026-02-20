import { Controller, Get, Req, UseGuards, Inject } from '@nestjs/common';
import { Request } from 'express';
import { ProviderRegistryService, DrizzleDb } from '@nexiom/engine';
import { appConnections } from '@nexiom/database';
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
  ) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new Error('Tenant ID missing from request');
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
          eq(appConnections.status, 'ACTIVE'),
        ),
      );

    return activeConnections;
  }
}
