import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InternalSchedulerGuard } from './internal-scheduler.guard.js';
import { SchedulerService } from './scheduler.service.js';
import { ExecuteStitchBody } from './execute-stitch.validation.js';

/**
 * Internal scheduler endpoints — called exclusively by Windmill workers.
 * Every route is protected by InternalSchedulerGuard (WINDMILL_INTERNAL_SECRET).
 */
@UseGuards(InternalSchedulerGuard)
@Controller('internal/scheduler')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  /**
   * POST /internal/scheduler/execute-stitch
   *
   * Invoked by the Windmill stitch-runner script to execute a sync job.
   * Returns 200 immediately with the execution result.
   */
  @Post('execute-stitch')
  @HttpCode(HttpStatus.OK)
  async executeStitch(@Body() body: ExecuteStitchBody) {
    // Wrap the entire call so that raw internal errors (DB connection strings,
    // vendor tokens, stack traces) are never surfaced in the HTTP response body
    // seen by Windmill workers.
    try {
      const result = await this.schedulerService.executeStitch(body.stitchId);
      if (result.status === 'failed') {
        throw new InternalServerErrorException('Stitch execution failed');
      }
      return result;
    } catch (err) {
      // Re-throw NestJS HTTP exceptions (NotFoundException, BadRequestException,
      // etc.) unchanged so domain errors surface as the correct 4xx status.
      // Only wrap truly unexpected errors as 500 to avoid leaking internals.
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException('Stitch execution failed');
    }
  }
}
