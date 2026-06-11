import { Injectable, OnModuleInit, Inject } from "@nestjs/common";
import {
  QUEUE_SERVICE,
  QueueName,
  type PluginInstallEvent,
  type IQueueService,
} from "@soopa/queue";
import { InstallPieceUseCase } from "../core/use-cases/app-installer/install-piece.use-case.js";
import { NestPieceRegistryAdapter } from "../adapters/outbound/nest-piece-registry.adapter.js";
import { DrizzleWorkspacePiecesRepositoryAdapter } from "../adapters/outbound/drizzle-workspace-pieces.repository.js";

@Injectable()
export class AppInstallerProcessor implements OnModuleInit {
  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService,
    private readonly registryAdapter: NestPieceRegistryAdapter,
    private readonly repositoryAdapter: DrizzleWorkspacePiecesRepositoryAdapter,
  ) {}

  onModuleInit() {
    this.queueService.consume(
      QueueName.PluginInstallQueue,
      async (event: PluginInstallEvent) => {
        const useCase = new InstallPieceUseCase(
          this.registryAdapter,
          this.repositoryAdapter,
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
