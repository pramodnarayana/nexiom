export interface PluginInstallEvent {
  packageName: string;
  version: string;
  workspaceId: string;
  pieceId: string;
  requestMetadata?: {
    webhookReceivedAt: string;
    source: string;
  };
}
