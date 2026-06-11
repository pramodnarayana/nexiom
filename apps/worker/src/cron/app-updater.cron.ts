import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CheckPieceUpdatesUseCase } from "../core/use-cases/app-installer/check-piece-updates.use-case.js";
import { NestPieceRegistryAdapter } from "../adapters/outbound/nest-piece-registry.adapter.js";
import { DrizzleWorkspacePiecesRepositoryAdapter } from "../adapters/outbound/drizzle-workspace-pieces.repository.js";
import { NestQueuePublisherAdapter } from "../adapters/outbound/nest-queue.publisher.js";

@Injectable()
export class AppUpdaterCron {
  constructor(
    private readonly repositoryAdapter: DrizzleWorkspacePiecesRepositoryAdapter,
    private readonly registryAdapter: NestPieceRegistryAdapter,
    private readonly queuePublisherAdapter: NestQueuePublisherAdapter,
  ) {}

  @Cron(CronExpression.EVERY_12_HOURS)
  async checkUpdates() {
    const useCase = new CheckPieceUpdatesUseCase(
      this.repositoryAdapter,
      this.registryAdapter,
      this.queuePublisherAdapter,
    );

    try {
      await useCase.execute();
    } catch (_error) {
      // The use case internally catches and logs errors, but just in case
    }
  }
}
