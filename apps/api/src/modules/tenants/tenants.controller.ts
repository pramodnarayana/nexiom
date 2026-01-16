import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { TenantsService } from './tenants.service';
import { AuthGuard } from '../auth/auth.guard';
import { UpdateTenantStatus } from './tenants.validation';

@Controller('tenants')
@UseGuards(AuthGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  findAll(@Req() req: Request & { user: { id: string } }) {
    return this.tenantsService.findAllForUser(req.user.id);
  }

  @Patch(':id')
  updateStatus(@Param('id') id: string, @Body() body: UpdateTenantStatus) {
    return this.tenantsService.updateStatus(id, body.status);
  }
}
