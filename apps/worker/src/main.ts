import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { Logger } from "nestjs-pino";

async function bootstrap() {
  try {
    // Create app with default logger disabled so Pino can take over immediately
    const app = await NestFactory.createApplicationContext(AppModule, {
      bufferLogs: true,
    });

    // Use Pino Logger
    const logger = app.get(Logger);
    app.useLogger(logger);

    app.enableShutdownHooks();

    logger.log(`Soopa Worker application started and listening to queues...`);
    if (process.env.WORKER_LOG_FILE) {
      logger.log(
        `Logging output is also being redirected to ${process.env.WORKER_LOG_FILE}`,
      );
    }
  } catch (err: unknown) {
    console.error(
      "Failed to bootstrap Worker application",
      err instanceof Error ? err.stack : err,
    );
    process.exit(1);
  }
}
void bootstrap();
