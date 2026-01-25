import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  UseGuards,
  Req,
  Inject,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { UpdateTenantStatus } from './tenants.validation';
import { TENANT_PROVIDER, ITenantProvider } from '@nexiom/identity';

@Controller('tenants')
@UseGuards(AuthGuard)
export class TenantsController {
  constructor(
    @Inject(TENANT_PROVIDER) private readonly tenantProvider: ITenantProvider,
  ) {}

  @Get()
  findAll(@Req() req: Request & { user: { id: string } }) {
    return this.tenantProvider.findAllForUser(req.user.id);
  }

  @Patch(':id')
  updateStatus(@Param('id') id: string, @Body() body: UpdateTenantStatus) {
    return this.tenantProvider.updateStatus(id, body.status);
  }
}
