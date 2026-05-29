import { Module, Global } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import type pino from "pino";

@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get<string>("NODE_ENV") !== "production";
        const VALID_LOG_LEVELS = new Set([
          "trace",
          "debug",
          "info",
          "warn",
          "error",
          "fatal",
        ]);
        const raw = config.get<string>("LOG_LEVEL", "info");
        const logLevel = VALID_LOG_LEVELS.has(raw) ? raw : "info";

        const logFile = config.get<string>("WORKER_LOG_FILE");

        const targets: pino.TransportTargetOptions[] = [];

        if (isDev) {
          targets.push({
            target: "pino-pretty",
            level: logLevel,
            options: {
              colorize: true,
              singleLine: true,
              translateTime: "SYS:HH:MM:ss.l",
              ignore: "pid,hostname",
            },
          });
        } else {
          targets.push({
            target: "pino/file",
            level: logLevel,
            options: { destination: 1 }, // stdout
          });
        }

        if (logFile) {
          targets.push({
            target: "pino/file",
            level: "trace", // write everything to file, or respect logLevel
            options: { destination: logFile },
          });
        }

        return {
          pinoHttp: {
            level: "trace", // Root level must be lowest so transports can filter
            genReqId: () => randomUUID(),
            customProps: () => ({
              service: "nexiom-worker",
            }),
            transport: targets.length > 1 ? { targets } : targets[0],
          },
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class ObservabilityModule {}
