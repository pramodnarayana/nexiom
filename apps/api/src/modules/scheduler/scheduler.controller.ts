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
import { ExecuteConnectionBody } from './execute-connection.validation.js';

/**
 * Internal scheduler endpoints — called exclusively by Windmill workers.
 * Every route is protected by InternalSchedulerGuard (WINDMILL_INTERNAL_SECRET).
 */
@UseGuards(InternalSchedulerGuard)
@Controller('internal/scheduler')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  /**
   * POST /internal/scheduler/execute-connection
   *
   * Invoked by the Windmill connection-runner script to execute a sync job.
   * Returns 200 immediately with the execution result.
   */
  @Post('execute-connection')
  @HttpCode(HttpStatus.OK)
  async executeConnection(@Body() body: ExecuteConnectionBody) {
    // Wrap the entire call so that raw internal errors (DB connection strings,
    // vendor tokens, stack traces) are never surfaced in the HTTP response body
    // seen by Windmill workers.
    try {
      const result = await this.schedulerService.executeConnection(
        body.dataSourceId,
      );
      if (result.status === 'failed') {
        throw new InternalServerErrorException(
          'Connection sync execution failed',
        );
      }
      return result;
    } catch (err) {
      // Re-throw NestJS HTTP exceptions (NotFoundException, BadRequestException,
      // etc.) unchanged so domain errors surface as the correct 4xx status.
      // Only wrap truly unexpected errors as 500 to avoid leaking internals.
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException(
        'Connection sync execution failed',
      );
    }
  }
}
