import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { MetricsService } from './metrics.service.js';

/**
 * Allowable characters for an inbound x-request-id: alphanumeric, hyphens,
 * underscores. Max 128 chars — well above any real UUID or correlation ID.
 * Rejects payloads that could inject JSON fields or path-traversal sequences.
 */
const SAFE_TRACE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * ObservabilityModule — structured JSON logging via Pino.
 *
 * Transport strategy:
 *  - development  : pino-pretty (human-readable, coloured)
 *  - production   : JSON to stdout; a Vector sidecar (docker-compose service
 *                   `vector`) reads container stdout and ships to OpenObserve.
 *
 * Structured fields present on every HTTP request log:
 *  - traceId      : x-request-id header value, or auto-generated UUID when absent
 *  - service      : always "nexiom-api"
 *
 * Operational fields added per-request by guards and controllers via PinoLogger.assign():
 *  - connectionId : set by TenantRateLimitGuard after route param is parsed
 *  - layer        : set by pipeline services ("L1", "L2", …)
 *  - durationMs   : set by controllers after the operation completes
 */
@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get<string>('NODE_ENV') !== 'production';
        const VALID_LOG_LEVELS = new Set([
          'trace',
          'debug',
          'info',
          'warn',
          'error',
          'fatal',
        ]);
        const raw = config.get<string>('LOG_LEVEL', 'info');
        const logLevel = VALID_LOG_LEVELS.has(raw) ? raw : 'info';

        return {
          pinoHttp: {
            level: logLevel,

            // Always produce a traceId: prefer the vendor-supplied x-request-id
            // header so distributed traces remain correlated; fall back to a
            // locally-generated UUID when the header is absent or unsafe.
            // The header is validated against SAFE_TRACE_ID_RE to prevent
            // log injection — an attacker-controlled value written verbatim
            // into every log line could forge structured fields or pollute traces.
            genReqId: (req: IncomingMessage) => {
              const incoming = req.headers['x-request-id'];
              if (
                typeof incoming === 'string' &&
                SAFE_TRACE_ID_RE.test(incoming)
              ) {
                return incoming;
              }
              return randomUUID();
            },

            // Attach request-scoped context fields to every log line emitted
            // during the request lifecycle.
            // NOTE: Express route params (req.params) are NOT available here —
            // the router hasn't matched the path yet. connectionId is set later
            // by TenantRateLimitGuard via PinoLogger.assign({ connectionId }).
            customProps: (req: IncomingMessage) => ({
              service: 'nexiom-api',
              traceId: (req as IncomingMessage & { id: string }).id,
            }),

            // Keep req/res serializers lean — verbose headers clutter logs.
            serializers: {
              req(req: { method: string; url: string }) {
                return { method: req.method, url: req.url };
              },
              res(res: { statusCode: number }) {
                return { statusCode: res.statusCode };
              },
            },

            // Human-readable summary line alongside structured fields.
            customSuccessMessage(
              req: IncomingMessage,
              _res: unknown,
              responseTime: number,
            ) {
              return `${req.method} ${req.url} (${responseTime}ms)`;
            },
            customErrorMessage(
              req: IncomingMessage,
              _res: unknown,
              err: Error,
            ) {
              const msg = err.message || '';
              const safeMsg =
                msg.length > 200 ? msg.substring(0, 200) + '...' : msg;
              return `${req.method} ${req.url} — ${safeMsg}`;
            },

            // pino-pretty in dev; stdout JSON in production (picked up by Vector).
            ...(isDev && {
              transport: {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  singleLine: true,
                  translateTime: 'SYS:HH:MM:ss.l',
                  ignore: 'pid,hostname',
                },
              },
            }),
          },
        };
      },
    }),
  ],
  providers: [MetricsService],
  exports: [LoggerModule, MetricsService],
})
export class ObservabilityModule {}
