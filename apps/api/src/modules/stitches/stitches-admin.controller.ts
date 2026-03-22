import {
  Controller,
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
