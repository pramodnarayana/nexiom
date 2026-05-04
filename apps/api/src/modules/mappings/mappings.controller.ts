import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Put,
} from '@nestjs/common';
import { MappingsService } from './mappings.service.js';
import { CreateMapping, UpdateMapping } from './mappings.validation.js';
import { SystemAdminGuard } from '../identity/auth/system-admin.guard.js';

@Controller('admin/mappings/:tenantId')
@UseGuards(SystemAdminGuard)
export class MappingsController {
  constructor(private readonly mappingsService: MappingsService) {}

  @Post()
  create(@Param('tenantId') tenantId: string, @Body() payload: CreateMapping) {
    return this.mappingsService.create(tenantId, payload);
  }

  @Get()
  findAll(@Param('tenantId') tenantId: string) {
    return this.mappingsService.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.mappingsService.findOne(tenantId, id);
  }

  @Patch(':id')
  updatePartial(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() payload: UpdateMapping,
  ) {
    return this.mappingsService.update(tenantId, id, payload);
  }

  @Put(':id')
  update(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() payload: UpdateMapping,
  ) {
    return this.mappingsService.update(tenantId, id, payload);
  }

  @Delete(':id')
  remove(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.mappingsService.remove(tenantId, id);
  }
}
