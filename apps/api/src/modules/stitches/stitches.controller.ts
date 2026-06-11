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
} from '@soopa/auth';
import { CreateStitchUseCase } from './core/use-cases/stitches/create-stitch.use-case.js';
import { ListStitchesUseCase } from './core/use-cases/stitches/list-stitches.use-case.js';
import { GetStitchUseCase } from './core/use-cases/stitches/get-stitch.use-case.js';
import { UpdateStitchUseCase } from './core/use-cases/stitches/update-stitch.use-case.js';
import { ArchiveStitchUseCase } from './core/use-cases/stitches/archive-stitch.use-case.js';
import { CreateStitch, UpdateStitch } from './stitches.validation.js';

import { requireOrgId } from '../workspaces/workspace.utils.js';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('stitches')
export class StitchesController {
  constructor(
    private readonly createStitchUseCase: CreateStitchUseCase,
    private readonly listStitchesUseCase: ListStitchesUseCase,
    private readonly getStitchUseCase: GetStitchUseCase,
    private readonly updateStitchUseCase: UpdateStitchUseCase,
    private readonly archiveStitchUseCase: ArchiveStitchUseCase,
  ) {}

  @Post()
  @RequirePermission('stitches', 'manage')
  create(@AuthContext() auth: RequestAuthContext, @Body() body: CreateStitch) {
    return this.createStitchUseCase.execute(requireOrgId(auth), body);
  }

  @Get()
  @RequirePermission('stitches', 'read')
  list(
    @AuthContext() auth: RequestAuthContext,
    @Query('workspaceId', new ParseUUIDPipe({ optional: true }))
    workspaceId?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.listStitchesUseCase.execute(
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
    return this.getStitchUseCase.execute(requireOrgId(auth), id);
  }

  @Patch(':id')
  @RequirePermission('stitches', 'manage')
  update(
    @AuthContext() auth: RequestAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStitch,
  ) {
    return this.updateStitchUseCase.execute(requireOrgId(auth), id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('stitches', 'manage')
  remove(
    @AuthContext() auth: RequestAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.archiveStitchUseCase.execute(requireOrgId(auth), id);
  }
}
