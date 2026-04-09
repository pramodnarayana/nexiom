import type { Request } from 'express';
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import crypto from 'node:crypto';

/**
 * AiTelemetryInterceptor — request-scoped trace ID propagation.
 *
 * Reads `x-trace-id` from the incoming request header (set by the API Gateway)
 * or generates a fresh UUID if absent. Binds the traceId onto the request object
 * so OrchestratorService can propagate it through every log statement for
 * end-to-end traceability into Datadog/Grafana.
 *
 * Logs SUCCESS / FAILURE with duration on stream completion.
 */
@Injectable()
export class AiTelemetryInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AiTelemetryInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { traceId?: string }>();
    const traceId: string =
      (req.headers['x-trace-id'] as string | undefined) ?? crypto.randomUUID();

    // Bind for downstream service access
    req.traceId = traceId;

    // Bind into pino's async-local-storage context so every child log carries it
    this.logger.assign({ traceId });

    const start = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.info(
            { traceId, durationMs: Date.now() - start },
            'AI chat stream completed',
          );
        },
        error: (err: Error) => {
          this.logger.error(
            { traceId, durationMs: Date.now() - start, err: err.message },
            'AI chat stream failed',
          );
        },
      }),
    );
  }
}
