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
      if (
        exception.name === 'EntityNotFoundError' ||
        exception.message.includes('not found')
      ) {
        status = HttpStatus.NOT_FOUND;
        message = exception.message;
      } else if (
        exception.name === 'UniqueConstraintViolation' ||
        exception.message.includes('already exists')
      ) {
        status = HttpStatus.CONFLICT;
        message = exception.message;
      } else if (
        exception.name === 'ValidationError' ||
        exception.name === 'BadRequestException'
      ) {
        status = HttpStatus.BAD_REQUEST;
        message = exception.message;
      } else {
        // Known NestJS HttpExceptions are usually caught by default filters,
        // but if they hit here, we handle them.
        const ex = exception as Error & { getStatus?: () => number };
        if (typeof ex.getStatus === 'function') {
          status = ex.getStatus();
          message = exception.message;
        } else {
          this.logger.error(
            `Unhandled domain exception: ${exception.message}`,
            exception.stack,
          );
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
