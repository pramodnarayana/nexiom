import { Injectable } from "@nestjs/common";
import { PipelineHookBrokerService } from "@soopa/pipeline";
import type {
  PipelineHookBrokerPort,
  MissingDependency,
} from "../../core/ports/outbound/pipeline-hook-broker.port.js";

@Injectable()
export class NestPipelineHookBrokerAdapter implements PipelineHookBrokerPort {
  constructor(private readonly hookBrokerService: PipelineHookBrokerService) {}

  async triggerActiveFetch(
    appName: string,
    appProfile: string,
    missingDependencies: MissingDependency[],
    dataSourceId: string,
  ): Promise<void> {
    await this.hookBrokerService.activeFetch(
      appName,
      appProfile,
      missingDependencies,
      dataSourceId,
    );
  }
}
