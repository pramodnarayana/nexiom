export interface PluginInstallEvent {
  packageName: string;
  version: string;
  requestMetadata?: {
    webhookReceivedAt: string;
    source: string;
  };
}
