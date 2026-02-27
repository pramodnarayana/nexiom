import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  UseGuards,
  Req,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard, PermissionsGuard, RequirePermission } from '@nexiom/auth';
import { UpdateTenantStatus, UpdateTenantDto } from './tenants.validation';
import { TENANT_PROVIDER, ITenantProvider } from '@nexiom/identity';

@Controller('tenants')
@UseGuards(AuthGuard, PermissionsGuard)
export class TenantsController {
  constructor(
    @Inject(TENANT_PROVIDER) private readonly tenantProvider: ITenantProvider,
  ) {}

  @Get()
  /**
   * Fetch all tenants for the user (Context Discovery).
   * Permission enforcement is deliberately omitted here to allow users
   * to discover which tenants they belong to.
   * Uses `tenantProvider.findAllForUser` which filters by userId.
   */
  findAll(@Req() req: Request & { user: { id: string } }) {
    return this.tenantProvider.findAllForUser(req.user.id);
  }

  @Get(':id')
  @RequirePermission('tenants', 'read')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    const tenant = await this.tenantProvider.findOneForUser(req.user.id, id);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  @Patch(':id')
  @RequirePermission('system_tenants', 'manage')
  updateStatus(@Param('id') id: string, @Body() body: UpdateTenantStatus) {
    return this.tenantProvider.updateStatus(id, body.status);
  }

  @Patch(':id/details')
  @RequirePermission('settings', 'manage')
  async updateDetails(
    @Param('id') id: string,
    @Body() body: UpdateTenantDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    const tenant = await this.tenantProvider.findOneForUser(req.user.id, id);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return this.tenantProvider.update(id, body);
  }
}
