import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { Logger } from "@nestjs/common";

async function bootstrap() {
  try {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ["error", "warn", "log", "debug", "verbose"],
    });

    app.enableShutdownHooks();

    const logger = new Logger("TenantProvisionerBootstrap");
    logger.log(
      "Soopa Tenant Provisioner started — listening on TenantProvisionQueue...",
    );
  } catch (err: unknown) {
    const logger = new Logger("TenantProvisionerBootstrap");
    logger.error(
      "Failed to bootstrap Tenant Provisioner",
      err instanceof Error ? err.stack : err,
    );
    process.exit(1);
  }
}
void bootstrap();
