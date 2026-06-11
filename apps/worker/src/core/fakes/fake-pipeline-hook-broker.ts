/* eslint-disable @typescript-eslint/require-await */
import type {
  PipelineHookBrokerPort,
  MissingDependency,
} from "../ports/outbound/pipeline-hook-broker.port.js";

export class FakePipelineHookBroker implements PipelineHookBrokerPort {
  public triggeredFetches: {
    appName: string;
    appProfile: string;
    missingDependencies: MissingDependency[];
    dataSourceId: string;
  }[] = [];

  async triggerActiveFetch(
    appName: string,
    appProfile: string,
    missingDependencies: MissingDependency[],
    dataSourceId: string,
  ): Promise<void> {
    this.triggeredFetches.push({
      appName,
      appProfile,
      missingDependencies,
      dataSourceId,
    });
  }
}
