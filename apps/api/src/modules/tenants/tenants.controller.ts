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

@Controller('organizations')
@UseGuards(AuthGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  findAll(@Query('search') search?: string) {
    return this.tenantsService.findAll(search);
  }

  @Patch(':id')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: 'active' | 'disabled' | 'suspended',
  ) {
    return this.tenantsService.updateStatus(id, status);
  }
}
