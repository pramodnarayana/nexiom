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
  NotImplementedException,
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
import { UpdateScheduleBody } from './update-schedule.validation.js';
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

  @Patch(':id/schedule')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('stitches', 'manage')
  updateSchedule(
    @AuthContext() auth: RequestAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateScheduleBody,
  ) {
    // TODO(T029): call SchedulerService.reschedule/disable
    return this.stitchesService.updateSchedule(requireOrgId(auth), id, body);
  }

  @Post(':id/schedule/trigger')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @RequirePermission('stitches', 'manage')
  triggerSchedule(
    @AuthContext() _auth: RequestAuthContext,
    @Param('id', ParseUUIDPipe) _id: string,
  ) {
    // T029: on-demand trigger requires SchedulerService — not yet implemented.
    throw new NotImplementedException(
      'On-demand sync trigger is not yet available.',
    );
  }
}
