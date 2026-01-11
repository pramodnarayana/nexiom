import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  UseGuards,
  Query,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { AuthGuard } from '../auth/auth.guard';
import { UpdateTenantStatus } from './tenants.schema';

@Controller('tenants')
@UseGuards(AuthGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  findAll(@Query('search') search?: string) {
    return this.tenantsService.findAll(search);
  }

  @Patch(':id')
  updateStatus(@Param('id') id: string, @Body() body: UpdateTenantStatus) {
    return this.tenantsService.updateStatus(id, body.status);
  }
}
