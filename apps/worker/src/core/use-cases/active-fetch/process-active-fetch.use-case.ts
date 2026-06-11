import { Logger } from "@nestjs/common";
import type { DataSourceRepositoryPort } from "../../ports/outbound/data-source-repository.port.js";
import type {
  PipelineHookBrokerPort,
  MissingDependency,
} from "../../ports/outbound/pipeline-hook-broker.port.js";

export class ProcessActiveFetchUseCase {
  private readonly logger = new Logger(ProcessActiveFetchUseCase.name);

  constructor(
    private readonly dataSourceRepository: DataSourceRepositoryPort,
    private readonly hookBroker: PipelineHookBrokerPort,
  ) {}

  async execute(
    traceId: string,
    dataSourceId: string,
    missingDependencies: MissingDependency[],
  ): Promise<void> {
    this.logger.debug(
      {
        event: "active_fetch.started",
        traceId,
        dataSourceId,
        count: missingDependencies.length,
      },
      "ActiveFetchUseCase started",
    );

    const metadata =
      await this.dataSourceRepository.getDataSourceMetadata(dataSourceId);

    await this.hookBroker.triggerActiveFetch(
      metadata.appName,
      metadata.appProfile,
      missingDependencies,
      dataSourceId,
    );

    this.logger.log(
      { event: "active_fetch.completed", traceId, dataSourceId },
      "ActiveFetchUseCase completed successfully",
    );
  }
}
