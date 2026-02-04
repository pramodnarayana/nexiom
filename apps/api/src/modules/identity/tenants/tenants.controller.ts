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
import { AuthGuard } from '../auth/auth.guard';
import { UpdateTenantStatus, UpdateTenantDto } from './tenants.validation';
import { TENANT_PROVIDER, ITenantProvider } from '@nexiom/identity';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';

@Controller('tenants')
@UseGuards(AuthGuard, PermissionsGuard)
export class TenantsController {
  constructor(
    @Inject(TENANT_PROVIDER) private readonly tenantProvider: ITenantProvider,
  ) {}

  @Get()
  // @RequirePermission('tenants', 'read') -- Removed to allow fetching own tenants without context
  findAll(@Req() req: Request & { user: { id: string } }) {
    return this.tenantProvider.findAllForUser(req.user.id);
  }

  @Get(':id')
  @RequirePermission('tenants', 'read')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    const myTenants = await this.tenantProvider.findAllForUser(req.user.id);
    const tenant = myTenants.find((t) => t.id === id);
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
  updateDetails(@Param('id') id: string, @Body() body: UpdateTenantDto) {
    return this.tenantProvider.update(id, body);
  }
}
