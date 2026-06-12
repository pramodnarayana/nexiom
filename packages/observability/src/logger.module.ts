import { Module, DynamicModule, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const SAFE_TRACE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

@Global()
@Module({})
export class LoggerModule {
  static forRoot(serviceName: string): DynamicModule {
    return {
      module: LoggerModule,
      imports: [
        PinoLoggerModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => {
            const isDev = config.get<string>('NODE_ENV') !== 'production';
            const VALID_LOG_LEVELS = new Set([
              'trace', 'debug', 'info', 'warn', 'error', 'fatal',
            ]);
            const raw = config.get<string>('LOG_LEVEL', 'info');
            const logLevel = VALID_LOG_LEVELS.has(raw) ? raw : 'info';
            const logFile = config.get<string>('WORKER_LOG_FILE');

            const targets: any[] = [];

            if (isDev) {
              targets.push({
                target: 'pino-pretty',
                level: logLevel,
                options: {
                  colorize: true,
                  singleLine: true,
                  translateTime: 'SYS:HH:MM:ss.l',
                  ignore: 'pid,hostname',
                },
              });
            } else {
              targets.push({
                target: 'pino/file',
                level: logLevel,
                options: { destination: 1 }, // stdout
              });
            }

            if (logFile && serviceName === 'app-worker') {
              targets.push({
                target: 'pino/file',
                level: 'trace',
                options: { destination: logFile },
              });
            }

            return {
              pinoHttp: {
                level: 'trace', // Root level lowest so transports can filter
                genReqId: (req: IncomingMessage) => {
                  const incoming = req.headers ? req.headers['x-request-id'] : undefined;
                  if (typeof incoming === 'string' && SAFE_TRACE_ID_RE.test(incoming)) {
                    return incoming;
                  }
                  return randomUUID();
                },
                customProps: (req: IncomingMessage) => ({
                  service: serviceName,
                  traceId: (req as any).id,
                }),
                serializers: {
                  req(req: any) {
                    return { method: req.method, url: req.url };
                  },
                  res(res: any) {
                    return { statusCode: res.statusCode };
                  },
                },
                transport: targets.length > 1 ? { targets } : targets[0],
              },
            };
          },
        }),
      ],
      exports: [PinoLoggerModule],
    };
  }
}
