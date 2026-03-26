import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { Logger } from "@nestjs/common";

async function bootstrap() {
  try {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ["error", "warn", "log", "debug", "verbose"],
    });

    app.enableShutdownHooks();

    const logger = new Logger("WorkerBootstrap");
    logger.log("Nexiom Worker application started and listening to queues...");
  } catch (err: unknown) {
    const logger = new Logger("WorkerBootstrap");
    logger.error(
      "Failed to bootstrap Worker application",
      err instanceof Error ? err.stack : err,
    );
    process.exit(1);
  }
}
bootstrap().catch(() => process.exit(1));
