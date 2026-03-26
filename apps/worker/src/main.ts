import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { Logger } from "@nestjs/common";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log", "debug", "verbose"],
  });

  app.enableShutdownHooks();

  const logger = new Logger("WorkerBootstrap");
  logger.log("Nexiom Worker application started and listening to queues...");
}
bootstrap();
