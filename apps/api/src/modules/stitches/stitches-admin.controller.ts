import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nexiom/auth';
import { SystemAdminGuard } from '../identity/auth/system-admin.guard.js';
import { StitchesService } from './stitches.service.js';
import { AdminUpdateScheduleBody } from './update-schedule.validation.js';

@UseGuards(AuthGuard, SystemAdminGuard)
@Controller('admin/stitches')
export class StitchesAdminController {
  constructor(private readonly stitchesService: StitchesService) {}

  @Get()
  listAll() {
    return this.stitchesService.listAdmin();
  }

  // NOTE: this route must be declared before :id/schedule so NestJS does not
  // treat the literal "org" segment as a UUID param.
  @Patch('org/:orgId/schedule')
  @HttpCode(HttpStatus.OK)
  bulkUpdateOrgSchedule(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: AdminUpdateScheduleBody,
  ) {
    return this.stitchesService.bulkUpdateScheduleByOrg(orgId, body);
  }

  @Patch(':id/schedule')
  @HttpCode(HttpStatus.OK)
  updateSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminUpdateScheduleBody,
  ) {
    // Admin can update any stitch — no orgId scoping
    // TODO(T029): call SchedulerService.reschedule/disable
    return this.stitchesService.updateScheduleAdmin(id, body);
  }
}
