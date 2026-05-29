import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  PermissionsGuard,
  RequirePermission,
  AuthContext,
  type RequestAuthContext,
} from '@nexiom/auth';
import { StitchesService } from './stitches.service.js';
import { CreateStitch, UpdateStitch } from './stitches.validation.js';

import { requireOrgId } from '../workspaces/workspace.utils.js';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('stitches')
export class StitchesController {
  constructor(private readonly stitchesService: StitchesService) {}

  @Post()
  @RequirePermission('stitches', 'manage')
  create(@AuthContext() auth: RequestAuthContext, @Body() body: CreateStitch) {
    return this.stitchesService.create(requireOrgId(auth), body);
  }

  @Get()
  @RequirePermission('stitches', 'read')
  list(
    @AuthContext() auth: RequestAuthContext,
    @Query('workspaceId', new ParseUUIDPipe({ optional: true }))
    workspaceId?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.stitchesService.list(
      requireOrgId(auth),
      workspaceId,
      includeArchived === 'true',
    );
  }

  @Get(':id')
  @RequirePermission('stitches', 'read')
  findOne(
    @AuthContext() auth: RequestAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.stitchesService.findOne(requireOrgId(auth), id);
  }

  @Patch(':id')
  @RequirePermission('stitches', 'manage')
  update(
    @AuthContext() auth: RequestAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStitch,
  ) {
    return this.stitchesService.update(requireOrgId(auth), id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('stitches', 'manage')
  remove(
    @AuthContext() auth: RequestAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.stitchesService.remove(requireOrgId(auth), id);
  }
}
