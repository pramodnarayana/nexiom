import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

// Define a common interface for domain exceptions
export interface DomainException extends Error {
  name: string;
  message: string;
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof Error) {
      // Log full exception for debugging
      this.logger.error(
        `Domain exception: ${exception.name}: ${exception.message}`,
        exception.stack,
      );

      if (exception.name === 'EntityNotFoundError') {
        status = HttpStatus.NOT_FOUND;
        message = 'Resource not found';
      } else if (exception.name === 'UniqueConstraintViolation') {
        status = HttpStatus.CONFLICT;
        message = 'Conflict';
      } else if (
        exception.name === 'ValidationError' ||
        exception.name === 'BadRequestException'
      ) {
        status = HttpStatus.BAD_REQUEST;
        message = 'Invalid request';
      } else {
        // Known NestJS HttpExceptions are usually caught by default filters,
        // but if they hit here, we handle them.
        const ex = exception as Error & { getStatus?: () => number };
        if (typeof ex.getStatus === 'function') {
          status = ex.getStatus();
          message = 'Request failed';
        }
      }
    } else {
      this.logger.error(`Unknown exception: ${String(exception)}`);
    }

    response.status(status).json({
      statusCode: status,
      message,
      error: HttpStatus[status],
    });
  }
}
