import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CheckPieceUpdatesUseCase } from "../core/use-cases/app-installer/check-piece-updates.use-case.js";
import { NestPieceRegistryAdapter } from "../adapters/outbound/nest-piece-registry.adapter.js";
import { DrizzleGlobalPiecesRepositoryAdapter } from "../adapters/outbound/drizzle-global-pieces.repository.js";
import { NestQueuePublisherAdapter } from "../adapters/outbound/nest-queue.publisher.js";

@Injectable()
export class AppUpdaterCron {
  private readonly logger = new Logger(AppUpdaterCron.name);

  constructor(
    private readonly repository: DrizzleGlobalPiecesRepositoryAdapter,
    private readonly registry: NestPieceRegistryAdapter,
    private readonly queuePublisher: NestQueuePublisherAdapter,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    this.logger.log("Checking for app updates...");

    const useCase = new CheckPieceUpdatesUseCase(
      this.repository,
      this.registry,
      this.queuePublisher,
      new Logger(CheckPieceUpdatesUseCase.name),
    );

    try {
      await useCase.execute();
    } catch (error) {
      this.logger.error(
        "Failed to execute app updater cron job",
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
