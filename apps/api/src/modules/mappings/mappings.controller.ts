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

@Controller('admin/mappings')
@UseGuards(SystemAdminGuard)
export class MappingsController {
  constructor(private readonly mappingsService: MappingsService) {}

  @Post()
  create(@Body() payload: CreateMapping) {
    return this.mappingsService.create(payload);
  }

  @Get()
  findAll() {
    return this.mappingsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.mappingsService.findOne(id);
  }

  @Patch(':id')
  updatePartial(@Param('id') id: string, @Body() payload: UpdateMapping) {
    return this.mappingsService.update(id, payload);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() payload: UpdateMapping) {
    return this.mappingsService.update(id, payload);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.mappingsService.remove(id);
  }
}
