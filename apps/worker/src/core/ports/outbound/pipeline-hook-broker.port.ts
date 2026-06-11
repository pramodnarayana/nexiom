export interface MissingDependency {
  entityType: string;
  sourceId: string;
}

export interface PipelineHookBrokerPort {
  triggerActiveFetch(
    appName: string,
    appProfile: string,
    missingDependencies: MissingDependency[],
    dataSourceId: string,
  ): Promise<void>;
}
