import { Injectable, OnModuleInit, Inject, Logger } from "@nestjs/common";
import {
  QUEUE_SERVICE,
  QueueName,
  type PluginInstallEvent,
  type IQueueService,
} from "@soopa/queue";
import { InstallPieceUseCase } from "../core/use-cases/app-installer/install-piece.use-case.js";
import { NestPieceRegistryAdapter } from "../adapters/outbound/nest-piece-registry.adapter.js";
import { DrizzleGlobalPiecesRepositoryAdapter } from "../adapters/outbound/drizzle-global-pieces.repository.js";

@Injectable()
export class AppInstallerProcessor implements OnModuleInit {
  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService,
    private readonly registryAdapter: NestPieceRegistryAdapter,
    private readonly repositoryAdapter: DrizzleGlobalPiecesRepositoryAdapter,
  ) {}

  onModuleInit() {
    this.queueService.consume(
      QueueName.PluginInstallQueue,
      async (event: PluginInstallEvent) => {
        const useCase = new InstallPieceUseCase(
          this.registryAdapter,
          this.repositoryAdapter,
          new Logger(InstallPieceUseCase.name),
        );

        await useCase.execute({
          packageName: event.packageName,
          version: event.version,
          workspaceId: event.workspaceId,
          pieceId: event.pieceId,
        });
      },
    );
  }
}
